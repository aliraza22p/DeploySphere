"""Application/service monitoring: health endpoints, checks and history."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from ..config import settings
from ..deps import CurrentUser, DbDep, EditorUser, record_audit
from ..errors import AppError
from ..models import (
    AppStatus,
    Application,
    DataSource,
    Environment,
    HealthCheck,
    LogRecord,
    LogSeverity,
    LogSource,
)
from ..schemas import ApplicationDetail, ApplicationIn, ApplicationOut, ApplicationUpdateIn, HealthCheckOut, Page
from ..ws import manager

router = APIRouter(prefix="/applications", tags=["applications"])


@router.get("", response_model=Page[ApplicationOut])
def list_applications(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    environment: str | None = None,
    status: str | None = None,
) -> Page[ApplicationOut]:
    stmt = select(Application)
    if environment:
        try:
            stmt = stmt.where(Application.environment == Environment(environment))
        except ValueError:
            raise AppError("bad_environment", f"Unknown environment '{environment}'", 400)
    if status:
        try:
            stmt = stmt.where(Application.status == AppStatus(status))
        except ValueError:
            raise AppError("bad_status", f"Unknown status '{status}'", 400)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Application.name.asc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(items=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=ApplicationOut, status_code=201)
def create_application(
    payload: ApplicationIn, request: Request, user: EditorUser, db: DbDep
) -> Application:
    app = Application(
        name=payload.name,
        server_id=payload.server_id,
        environment=Environment(payload.environment),
        health_url=payload.health_url,
        version=payload.version,
        status=AppStatus.unknown,
    )
    db.add(app)
    db.commit()
    record_audit(db, user, "application.create", "application", app.id, app.name, request)
    return app


@router.get("/{application_id}", response_model=ApplicationDetail)
def get_application(application_id: int, user: CurrentUser, db: DbDep) -> ApplicationDetail:
    app = db.get(Application, application_id)
    if app is None:
        raise AppError("not_found", "Application not found", 404)
    detail = ApplicationDetail.model_validate(app)
    checks = db.scalars(
        select(HealthCheck)
        .where(HealthCheck.application_id == app.id)
        .order_by(HealthCheck.checked_at.desc())
        .limit(30)
    ).all()
    detail.checks = [HealthCheckOut.model_validate(c) for c in checks]
    return detail


@router.patch("/{application_id}", response_model=ApplicationOut)
def update_application(
    application_id: int,
    payload: ApplicationUpdateIn,
    request: Request,
    user: EditorUser,
    db: DbDep,
) -> Application:
    app = db.get(Application, application_id)
    if app is None:
        raise AppError("not_found", "Application not found", 404)
    changed = payload.model_dump(exclude_unset=True)
    for key, value in changed.items():
        if key == "environment" and value:
            value = Environment(value)
        setattr(app, key, value)
    db.commit()
    record_audit(db, user, "application.update", "application", app.id, ", ".join(changed), request)
    return app


@router.delete("/{application_id}", status_code=204)
def delete_application(
    application_id: int, request: Request, user: EditorUser, db: DbDep
) -> None:
    app = db.get(Application, application_id)
    if app is None:
        raise AppError("not_found", "Application not found", 404)
    record_audit(db, user, "application.delete", "application", app.id, app.name, request)
    db.delete(app)
    db.commit()


@router.post("/{application_id}/check", response_model=HealthCheckOut)
async def run_health_check(
    application_id: int, request: Request, user: EditorUser, db: DbDep
) -> HealthCheck:
    """Run a real HTTP health check when a URL is configured.

    Without a URL (common in demo mode) the check is recorded as skipped with
    an explicit message instead of pretending the service is healthy.
    """
    app = db.get(Application, application_id)
    if app is None:
        raise AppError("not_found", "Application not found", 404)

    now = datetime.now(timezone.utc)
    if not app.health_url:
        check = HealthCheck(
            application_id=app.id,
            ok=False,
            http_status=None,
            response_time_ms=None,
            message="No health URL configured — check skipped (set one in the application settings).",
            checked_at=now,
        )
        db.add(check)
        app.last_checked_at = now
        app.status = AppStatus.unknown
        db.commit()
        return check

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            response = await client.get(app.health_url)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        ok = 200 <= response.status_code < 300
        check = HealthCheck(
            application_id=app.id,
            ok=ok,
            http_status=response.status_code,
            response_time_ms=elapsed_ms,
            message="OK" if ok else f"HTTP {response.status_code}",
            checked_at=now,
        )
        app.status = AppStatus.healthy if ok else AppStatus.degraded
        app.http_status = response.status_code
        app.response_time_ms = elapsed_ms
    except Exception as exc:  # connection/timeout failures are real results
        check = HealthCheck(
            application_id=app.id,
            ok=False,
            http_status=None,
            response_time_ms=None,
            message=f"Check failed: {type(exc).__name__}",
            checked_at=now,
        )
        app.status = AppStatus.down
        app.http_status = None
        app.response_time_ms = None
    app.last_checked_at = now
    db.add(check)
    db.add(
        LogRecord(
            ts=now,
            source=LogSource.application,
            severity=LogSeverity.info if check.ok else LogSeverity.error,
            message=f"health check {app.name}: {check.message}",
            source_data=DataSource.demo if settings.demo_mode else DataSource.live,
        )
    )
    db.commit()
    record_audit(
        db, user, "application.health_check", "application", app.id, check.message, request
    )
    await manager.broadcast(
        {
            "type": "application.health",
            "payload": {
                "application_id": app.id,
                "name": app.name,
                "status": app.status.value,
                "message": check.message,
                "response_time_ms": check.response_time_ms,
            },
        }
    )
    return check
