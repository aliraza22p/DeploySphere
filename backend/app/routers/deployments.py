"""Deployment management across Development, Staging and Production.

Production deployments and rollbacks require explicit confirmation and an
administrator (configurable approval gate). All simulated rollouts are marked
source="demo"; when demo mode is disabled the endpoint reports that no real
deployment target is configured instead of fabricating success.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from ..config import settings
from ..deps import AdminUser, CurrentUser, DbDep, EditorUser, record_audit
from ..errors import AppError
from ..models import (
    AppSettings,
    DataSource,
    Deployment,
    DeploymentStatus,
    Environment,
    utcnow,
)
from ..schemas import DeploymentIn, DeploymentOut, Page, RollbackIn
from ..security import redact_secrets
from ..ws import manager

router = APIRouter(prefix="/deployments", tags=["deployments"])


def _get_or_404(db, deployment_id: int) -> Deployment:
    deployment = db.get(Deployment, deployment_id)
    if deployment is None:
        raise AppError("not_found", "Deployment not found", 404)
    return deployment


def _require_demo_mode() -> None:
    if not settings.demo_mode:
        raise AppError(
            "integration_not_configured",
            "No deployment target is configured. Enable demo mode or connect a "
            "deployment provider (Settings → Integrations) before deploying.",
            501,
        )


@router.get("", response_model=Page[DeploymentOut])
def list_deployments(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    environment: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> Page[DeploymentOut]:
    stmt = select(Deployment)
    if environment:
        try:
            stmt = stmt.where(Deployment.environment == Environment(environment))
        except ValueError:
            raise AppError("bad_environment", f"Unknown environment '{environment}'", 400)
    if status:
        try:
            stmt = stmt.where(Deployment.status == DeploymentStatus(status))
        except ValueError:
            raise AppError("bad_status", f"Unknown status '{status}'", 400)
    if q:
        stmt = stmt.where(
            Deployment.name.ilike(f"%{q}%") | Deployment.version.ilike(f"%{q}%")
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Deployment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page(items=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=DeploymentOut, status_code=201)
async def create_deployment(
    payload: DeploymentIn, request: Request, user: EditorUser, db: DbDep
) -> Deployment:
    _require_demo_mode()
    is_production = payload.environment == "production"

    if is_production:
        if payload.confirm != "production":
            raise AppError(
                "confirmation_required",
                "Type the environment name ('production') in the confirm field to "
                "deploy to production.",
                422,
            )
        if user.role.value != "administrator":
            raise AppError(
                "forbidden",
                "Only administrators may deploy to production.",
                403,
            )

    settings_row = db.scalars(select(AppSettings).limit(1)).first()
    needs_approval = bool(
        is_production and settings_row and settings_row.production_approval_required
    )

    deployment = Deployment(
        application_id=payload.application_id,
        name=payload.name,
        version=payload.version,
        commit_sha=payload.commit_sha,
        environment=Environment(payload.environment),
        status=DeploymentStatus.pending if needs_approval else DeploymentStatus.running,
        initiated_by=user.email,
        notes=payload.notes,
        requires_approval=needs_approval,
        source=DataSource.demo,
        started_at=None if needs_approval else utcnow(),
        log=(
            "deploy: request accepted\n"
            + (
                "deploy: awaiting administrator approval (approval gate enabled)\n"
                if needs_approval
                else "deploy: starting rollout (demo simulation)\n"
            )
            + f"deploy: target={payload.environment} version={payload.version}"
        ),
    )
    db.add(deployment)
    db.commit()
    record_audit(
        db,
        user,
        "deployment.production" if is_production else "deployment.create",
        "deployment",
        deployment.id,
        f"{payload.name} {payload.version} → {payload.environment}",
        request,
    )
    await manager.broadcast(
        {
            "type": "deployment.updated",
            "payload": {
                "deployment_id": deployment.id,
                "name": deployment.name,
                "version": deployment.version,
                "environment": deployment.environment.value,
                "status": deployment.status.value,
                "source": "demo",
            },
        }
    )
    return deployment


@router.get("/{deployment_id}", response_model=DeploymentOut)
def get_deployment(deployment_id: int, user: CurrentUser, db: DbDep) -> Deployment:
    return _get_or_404(db, deployment_id)


@router.post("/{deployment_id}/approve", response_model=DeploymentOut)
async def approve_deployment(
    deployment_id: int, request: Request, user: AdminUser, db: DbDep
) -> Deployment:
    deployment = _get_or_404(db, deployment_id)
    if deployment.status != DeploymentStatus.pending:
        raise AppError(
            "conflict", f"Deployment is {deployment.status.value}, not awaiting approval", 409
        )
    deployment.status = DeploymentStatus.running
    deployment.approved_by = user.email
    deployment.started_at = utcnow()
    deployment.log = redact_secrets(
        deployment.log + f"\ndeploy: approved by {user.email}\ndeploy: starting rollout"
    )
    db.commit()
    record_audit(
        db,
        user,
        "deployment.approve",
        "deployment",
        deployment.id,
        f"Approved {deployment.name} {deployment.version}",
        request,
    )
    await manager.broadcast(
        {
            "type": "deployment.updated",
            "payload": {
                "deployment_id": deployment.id,
                "name": deployment.name,
                "version": deployment.version,
                "environment": deployment.environment.value,
                "status": "running",
                "source": "demo",
            },
        }
    )
    return deployment


@router.post("/{deployment_id}/rollback", response_model=DeploymentOut, status_code=201)
async def rollback_deployment(
    deployment_id: int, payload: RollbackIn, request: Request, user: AdminUser, db: DbDep
) -> Deployment:
    _require_demo_mode()
    deployment = _get_or_404(db, deployment_id)
    is_production = deployment.environment == Environment.production
    if is_production and payload.confirm != "production":
        raise AppError(
            "confirmation_required",
            "Type 'production' in the confirm field to roll back a production deployment.",
            422,
        )

    # target = most recent successful deployment for the same app/env that is
    # not this deployment and not itself a rollback
    candidates = db.scalars(
        select(Deployment)
        .where(
            Deployment.name == deployment.name,
            Deployment.environment == deployment.environment,
            Deployment.status == DeploymentStatus.succeeded,
            Deployment.id != deployment.id,
            Deployment.rollback_of_id.is_(None),
        )
        .order_by(Deployment.created_at.desc())
    ).all()
    if not candidates:
        raise AppError(
            "no_rollback_target",
            "No previously successful version exists for this deployment target.",
            409,
        )
    target = candidates[0]

    rollback = Deployment(
        application_id=deployment.application_id,
        name=deployment.name,
        version=target.version,
        commit_sha=target.commit_sha,
        environment=deployment.environment,
        status=DeploymentStatus.running,
        initiated_by=user.email,
        approved_by=user.email,
        notes=f"Rollback of deployment #{deployment.id}. Reason: {payload.reason or 'not specified'}",
        rollback_of_id=deployment.id,
        requires_approval=False,
        source=DataSource.demo,
        started_at=utcnow(),
        log=(
            f"deploy: rollback requested by {user.email}\n"
            f"deploy: restoring version {target.version} (deployment #{target.id})\n"
            "deploy: draining connections and shifting traffic"
        ),
    )
    db.add(rollback)
    deployment.status = DeploymentStatus.rolled_back
    deployment.log = redact_secrets(
        deployment.log + f"\ndeploy: rollback executed to {target.version} by {user.email}"
    )
    db.commit()
    record_audit(
        db,
        user,
        "deployment.rollback",
        "deployment",
        rollback.id,
        f"{deployment.name}: {deployment.version} → {target.version}",
        request,
    )
    await manager.broadcast(
        {
            "type": "deployment.updated",
            "payload": {
                "deployment_id": rollback.id,
                "name": rollback.name,
                "version": rollback.version,
                "environment": rollback.environment.value,
                "status": "running",
                "source": "demo",
            },
        }
    )
    return rollback


@router.post("/{deployment_id}/logs", response_model=dict)
def deployment_logs(deployment_id: int, user: CurrentUser, db: DbDep) -> dict:
    deployment = _get_or_404(db, deployment_id)
    return {
        "deployment_id": deployment.id,
        "log": deployment.log,
        "health_check_result": deployment.health_check_result,
        "source": deployment.source.value,
    }
