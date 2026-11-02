"""CI/CD pipeline management: definitions, runs, stages, retry/cancel."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from ..deps import CurrentUser, DbDep, EditorUser, record_audit
from ..errors import AppError
from ..models import (
    DataSource,
    Environment,
    Pipeline,
    PipelineRun,
    PipelineStage,
    Repository,
    RunStatus,
    utcnow,
)
from ..schemas import (
    Page,
    PipelineIn,
    PipelineOut,
    PipelineRunDetail,
    PipelineRunOut,
    PipelineUpdateIn,
    StageOut,
    StageDefinition,
)
from ..ws import manager

router = APIRouter(tags=["pipelines"])

CANCELLED_STATUSES = {RunStatus.succeeded, RunStatus.failed, RunStatus.cancelled}


# --------------------------------------------------------------------------- #
# Pipeline definitions
# --------------------------------------------------------------------------- #


@router.get("/pipelines", response_model=Page[PipelineOut])
def list_pipelines(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    enabled: bool | None = None,
) -> Page[PipelineOut]:
    stmt = select(Pipeline)
    if q:
        stmt = stmt.where(Pipeline.name.ilike(f"%{q}%"))
    if enabled is not None:
        stmt = stmt.where(Pipeline.enabled.is_(enabled))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(Pipeline.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    items = []
    for pipeline in rows:
        out = PipelineOut.model_validate(pipeline)
        last_run = db.scalars(
            select(PipelineRun)
            .where(PipelineRun.pipeline_id == pipeline.id)
            .order_by(PipelineRun.queued_at.desc())
            .limit(1)
        ).first()
        out.last_run = PipelineRunOut.model_validate(last_run) if last_run else None
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("/pipelines", response_model=PipelineOut, status_code=201)
def create_pipeline(
    payload: PipelineIn, request: Request, user: EditorUser, db: DbDep
) -> Pipeline:
    repo = db.get(Repository, payload.repository_id)
    if repo is None:
        raise AppError("not_found", "Repository not found", 404)
    pipeline = Pipeline(
        name=payload.name,
        repository_id=repo.id,
        branch=payload.branch or repo.default_branch,
        triggers=payload.triggers,
        stages=[stage.model_dump() for stage in payload.stages],
        enabled=payload.enabled,
        timeout_seconds=payload.timeout_seconds,
        environment=Environment(payload.environment),
        created_by=user.email,
    )
    db.add(pipeline)
    db.commit()
    record_audit(db, user, "pipeline.create", "pipeline", pipeline.id, payload.name, request)
    return pipeline


@router.get("/pipelines/{pipeline_id}", response_model=PipelineOut)
def get_pipeline(pipeline_id: int, user: CurrentUser, db: DbDep) -> PipelineOut:
    pipeline = db.get(Pipeline, pipeline_id)
    if pipeline is None:
        raise AppError("not_found", "Pipeline not found", 404)
    out = PipelineOut.model_validate(pipeline)
    last_run = db.scalars(
        select(PipelineRun)
        .where(PipelineRun.pipeline_id == pipeline.id)
        .order_by(PipelineRun.queued_at.desc())
        .limit(1)
    ).first()
    out.last_run = PipelineRunOut.model_validate(last_run) if last_run else None
    return out


@router.patch("/pipelines/{pipeline_id}", response_model=PipelineOut)
def update_pipeline(
    pipeline_id: int,
    payload: PipelineUpdateIn,
    request: Request,
    user: EditorUser,
    db: DbDep,
) -> Pipeline:
    pipeline = db.get(Pipeline, pipeline_id)
    if pipeline is None:
        raise AppError("not_found", "Pipeline not found", 404)
    data = payload.model_dump(exclude_unset=True)
    if "stages" in data and data["stages"]:
        data["stages"] = [
            stage if isinstance(stage, dict) else StageDefinition(**stage).model_dump()
            for stage in data["stages"]
        ]
    for key, value in data.items():
        setattr(pipeline, key, value)
    if "environment" in data and data["environment"]:
        pipeline.environment = Environment(data["environment"])
    db.commit()
    record_audit(
        db,
        user,
        "pipeline.update",
        "pipeline",
        pipeline.id,
        f"Updated fields: {', '.join(data.keys())}",
        request,
    )
    return pipeline


@router.delete("/pipelines/{pipeline_id}", status_code=204)
def delete_pipeline(
    pipeline_id: int, request: Request, user: EditorUser, db: DbDep
) -> None:
    pipeline = db.get(Pipeline, pipeline_id)
    if pipeline is None:
        raise AppError("not_found", "Pipeline not found", 404)
    record_audit(db, user, "pipeline.delete", "pipeline", pipeline.id, pipeline.name, request)
    db.delete(pipeline)
    db.commit()


# --------------------------------------------------------------------------- #
# Runs
# --------------------------------------------------------------------------- #


@router.post("/pipelines/{pipeline_id}/run", response_model=PipelineRunDetail, status_code=201)
async def trigger_run(
    pipeline_id: int, request: Request, user: EditorUser, db: DbDep
) -> PipelineRunDetail:
    pipeline = db.get(Pipeline, pipeline_id)
    if pipeline is None:
        raise AppError("not_found", "Pipeline not found", 404)
    if not pipeline.enabled:
        raise AppError("pipeline_disabled", "Enable the pipeline before running it", 409)

    next_number = (
        db.scalar(
            select(func.max(PipelineRun.number)).where(PipelineRun.pipeline_id == pipeline.id)
        )
        or 1200
    ) + 1
    run = PipelineRun(
        pipeline_id=pipeline.id,
        number=next_number,
        status=RunStatus.queued,
        commit_sha=secrets.token_hex(20),
        commit_message="Manual trigger from DeploySphere UI",
        branch=pipeline.branch,
        triggered_by=user.email,
        trigger_event="manual",
        artifact_version="",
        source=DataSource.demo,
    )
    db.add(run)
    db.flush()
    for index, stage in enumerate(pipeline.stages):
        db.add(
            PipelineStage(
                run_id=run.id,
                key=stage.get("key", f"stage_{index}"),
                name=stage.get("name", stage.get("key", f"Stage {index + 1}")),
                position=index,
                status=RunStatus.queued,
            )
        )
    db.commit()
    record_audit(db, user, "pipeline.run", "pipeline", pipeline.id, f"Run #{next_number}", request)

    # demo simulator picks up queued runs immediately
    first = db.scalars(
        select(PipelineStage)
        .where(PipelineStage.run_id == run.id, PipelineStage.position == 0)
    ).first()
    if first is not None and settings_demo_runs():
        first.status = RunStatus.running
        first.started_at = utcnow()
        run.status = RunStatus.running
        run.started_at = utcnow()
        db.commit()
        await manager.broadcast(
            {
                "type": "pipeline.run.updated",
                "payload": {
                    "run_id": run.id,
                    "pipeline_id": run.pipeline_id,
                    "number": run.number,
                    "status": "running",
                    "stage_id": first.id,
                    "source": "demo",
                },
            }
        )
    detail = PipelineRunDetail.model_validate(run)
    detail.stages = [StageOut.model_validate(s) for s in run.stages]
    return detail


def settings_demo_runs() -> bool:
    from ..config import settings

    return settings.demo_mode and settings.simulator_enabled


@router.get("/pipeline-runs", response_model=Page[PipelineRunOut])
def list_runs(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    pipeline_id: int | None = None,
    status: str | None = None,
) -> Page[PipelineRunOut]:
    stmt = select(PipelineRun)
    if pipeline_id:
        stmt = stmt.where(PipelineRun.pipeline_id == pipeline_id)
    if status:
        try:
            stmt = stmt.where(PipelineRun.status == RunStatus(status))
        except ValueError:
            raise AppError("bad_status", f"Unknown status '{status}'", 400)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(PipelineRun.queued_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return Page(
        items=[PipelineRunOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/pipeline-runs/{run_id}", response_model=PipelineRunDetail)
def get_run(run_id: int, user: CurrentUser, db: DbDep) -> PipelineRunDetail:
    run = db.get(PipelineRun, run_id)
    if run is None:
        raise AppError("not_found", "Pipeline run not found", 404)
    detail = PipelineRunDetail.model_validate(run)
    detail.stages = [StageOut.model_validate(s) for s in run.stages]
    return detail


@router.post("/pipeline-runs/{run_id}/cancel", response_model=PipelineRunDetail)
async def cancel_run(
    run_id: int, request: Request, user: EditorUser, db: DbDep
) -> PipelineRunDetail:
    run = db.get(PipelineRun, run_id)
    if run is None:
        raise AppError("not_found", "Pipeline run not found", 404)
    if run.status in CANCELLED_STATUSES:
        raise AppError("conflict", f"Run is already {run.status.value}", 409)
    run.status = RunStatus.cancelled
    run.finished_at = utcnow()
    run.duration_seconds = (
        int((run.finished_at - run.started_at).total_seconds()) if run.started_at else 0
    )
    for stage in run.stages:
        if stage.status in {RunStatus.running, RunStatus.queued}:
            stage.status = RunStatus.cancelled
            stage.finished_at = utcnow()
    db.commit()
    record_audit(db, user, "pipeline.cancel", "pipeline_run", run.id, f"Run #{run.number}", request)
    await manager.broadcast(
        {
            "type": "pipeline.run.updated",
            "payload": {
                "run_id": run.id,
                "pipeline_id": run.pipeline_id,
                "number": run.number,
                "status": "cancelled",
                "source": "live",
            },
        }
    )
    detail = PipelineRunDetail.model_validate(run)
    detail.stages = [StageOut.model_validate(s) for s in run.stages]
    return detail


@router.post(
    "/pipeline-runs/{run_id}/stages/{stage_id}/retry", response_model=PipelineRunDetail
)
async def retry_stage(
    run_id: int,
    stage_id: int,
    request: Request,
    user: EditorUser,
    db: DbDep,
) -> PipelineRunDetail:
    run = db.get(PipelineRun, run_id)
    if run is None:
        raise AppError("not_found", "Pipeline run not found", 404)
    stage = next((s for s in run.stages if s.id == stage_id), None)
    if stage is None:
        raise AppError("not_found", "Stage not found", 404)
    if stage.status not in {RunStatus.failed, RunStatus.cancelled}:
        raise AppError(
            "not_retryable", "Only failed or cancelled stages can be retried", 409
        )
    stage.status = RunStatus.running
    stage.attempt += 1
    stage.started_at = utcnow()
    stage.finished_at = None
    stage.duration_seconds = None
    stage.log = f"[stage:{stage.key}] retry attempt #{stage.attempt} queued by {user.email}"
    run.status = RunStatus.running
    run.finished_at = None
    db.commit()
    record_audit(
        db, user, "pipeline.stage_retry", "pipeline_stage", stage.id, stage.name, request
    )
    await manager.broadcast(
        {
            "type": "pipeline.run.updated",
            "payload": {
                "run_id": run.id,
                "pipeline_id": run.pipeline_id,
                "number": run.number,
                "status": "running",
                "stage_id": stage.id,
                "source": "live",
            },
        }
    )
    detail = PipelineRunDetail.model_validate(run)
    detail.stages = [StageOut.model_validate(s) for s in run.stages]
    return detail
