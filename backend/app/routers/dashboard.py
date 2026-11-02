"""Overview dashboard: summary counts, fleet metrics, trends and recent activity."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from ..cache import cache_get, cache_set
from ..deps import CurrentUser, DbDep
from ..models import (
    Alert,
    AlertSeverity,
    AlertStatus,
    AppSettings,
    Application,
    Deployment,
    DeploymentStatus,
    Pipeline,
    PipelineRun,
    Server,
    TelemetrySample,
)
from ..schemas import (
    AlertOut,
    ApplicationOut,
    DashboardSummary,
    DeploymentOut,
    PipelineRunOut,
)
from ..series import downsample, range_delta, since

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def summary(
    user: CurrentUser,
    db: DbDep,
    range: str = Query(default="24h", pattern="^(1h|24h|7d|30d)$"),
) -> DashboardSummary:
    cached = cache_get(f"dashboard:summary:{range}")
    if cached:
        return DashboardSummary.model_validate(cached)

    now = datetime.now(timezone.utc)
    start = since(range)

    # -- server health counts ------------------------------------------- #
    server_rows = db.execute(
        select(Server.status, func.count()).group_by(Server.status)
    ).all()
    server_counts = {"total": 0, "healthy": 0, "warning": 0, "critical": 0, "offline": 0}
    for status, count in server_rows:
        server_counts[status.value] = count
        server_counts["total"] += count

    servers = db.scalars(select(Server)).all()
    live = [s for s in servers if s.status.value != "offline"]
    fleet = {
        "cpu_percent": round(sum(s.cpu_percent for s in live) / len(live), 1) if live else 0.0,
        "memory_percent": round(sum(s.memory_percent for s in live) / len(live), 1) if live else 0.0,
        "disk_percent": round(sum(s.disk_percent for s in live) / len(live), 1) if live else 0.0,
        "network_in_mbps": round(sum(s.network_in_mbps for s in live), 1),
        "network_out_mbps": round(sum(s.network_out_mbps for s in live), 1),
    }
    total_uptime = sum(s.uptime_seconds for s in live)

    # -- pipeline counts -------------------------------------------------- #
    runs_in_range = db.scalars(
        select(PipelineRun).where(PipelineRun.queued_at >= start)
    ).all()
    run_status_counts: dict[str, int] = {}
    for run in runs_in_range:
        run_status_counts[run.status.value] = run_status_counts.get(run.status.value, 0) + 1
    active_pipelines = db.scalar(
        select(func.count()).select_from(Pipeline).where(Pipeline.enabled.is_(True))
    ) or 0
    pipeline_counts = {
        "active": active_pipelines,
        "total": db.scalar(select(func.count()).select_from(Pipeline)) or 0,
        "succeeded": run_status_counts.get("succeeded", 0),
        "failed": run_status_counts.get("failed", 0),
        "running": run_status_counts.get("running", 0),
        "queued": run_status_counts.get("queued", 0),
        "cancelled": run_status_counts.get("cancelled", 0),
    }

    # -- deployments ------------------------------------------------------ #
    deployments_in_range = db.scalars(
        select(Deployment).where(Deployment.created_at >= start)
    ).all()
    deploy_status_counts: dict[str, int] = {}
    for deployment in deployments_in_range:
        key = deployment.status.value
        deploy_status_counts[key] = deploy_status_counts.get(key, 0) + 1
    deployment_counts = {
        "succeeded": deploy_status_counts.get("succeeded", 0),
        "failed": deploy_status_counts.get("failed", 0),
        "running": deploy_status_counts.get("running", 0),
        "pending": deploy_status_counts.get("pending", 0),
        "rolled_back": deploy_status_counts.get("rolled_back", 0),
        "total": len(deployments_in_range),
    }

    # -- alerts ------------------------------------------------------------ #
    alert_status_rows = db.execute(
        select(Alert.status, func.count()).where(Alert.created_at >= start).group_by(Alert.status)
    ).all()
    alert_counts = {status.value: count for status, count in alert_status_rows}
    alert_counts.setdefault("open", 0)
    alert_counts.setdefault("acknowledged", 0)
    alert_counts.setdefault("muted", 0)
    alert_counts.setdefault("resolved", 0)
    alert_counts["critical"] = db.scalar(
        select(func.count())
        .select_from(Alert)
        .where(
            Alert.severity == AlertSeverity.critical,
            Alert.status.in_([AlertStatus.open, AlertStatus.acknowledged]),
        )
    ) or 0

    # -- fleet metric series ---------------------------------------------- #
    samples = db.scalars(
        select(TelemetrySample)
        .where(TelemetrySample.ts >= start)
        .order_by(TelemetrySample.ts.asc())
    ).all()
    series = downsample(samples)

    # -- deployment trend (per day) --------------------------------------- #
    trend_buckets: dict[str, dict[str, int]] = {}
    span_days = max(1, int(range_delta(range).total_seconds() // 86_400)) if range != "1h" else 1
    # NOTE: the query param is named `range`, so the builtin cannot be used here.
    day_index = 0
    while day_index < span_days:
        day = (now - timedelta(days=span_days - 1 - day_index)).strftime("%Y-%m-%d")
        trend_buckets[day] = {"succeeded": 0, "failed": 0, "total": 0}
        day_index += 1
    for deployment in deployments_in_range:
        day = (deployment.created_at or now).strftime("%Y-%m-%d")
        bucket = trend_buckets.setdefault(day, {"succeeded": 0, "failed": 0, "total": 0})
        bucket["total"] += 1
        if deployment.status == DeploymentStatus.succeeded:
            bucket["succeeded"] += 1
        elif deployment.status in {DeploymentStatus.failed, DeploymentStatus.rolled_back}:
            bucket["failed"] += 1
    deployment_trend = [{"day": day, **counts} for day, counts in sorted(trend_buckets.items())]

    # -- recent activity --------------------------------------------------- #
    recent_deployments = db.scalars(
        select(Deployment).order_by(Deployment.created_at.desc()).limit(6)
    ).all()
    recent_alerts = db.scalars(
        select(Alert)
        .where(Alert.status.in_([AlertStatus.open, AlertStatus.acknowledged, AlertStatus.muted]))
        .order_by(Alert.created_at.desc())
        .limit(6)
    ).all()
    recent_runs = (
        db.scalars(select(PipelineRun).order_by(PipelineRun.queued_at.desc()).limit(6)).all()
    )
    services = db.scalars(select(Application).order_by(Application.name.asc())).all()[:8]

    settings_row = db.scalars(select(AppSettings).limit(1)).first()
    payload = DashboardSummary(
        data_source="demo" if (settings_row.demo_mode if settings_row else False) else "live",
        server_counts=server_counts,
        pipeline_counts=pipeline_counts,
        deployment_counts=deployment_counts,
        alert_counts=alert_counts,
        fleet=fleet,
        uptime_seconds=total_uptime,
        series=[point for point in series],
        deployment_trend=deployment_trend,
        recent_deployments=[DeploymentOut.model_validate(d) for d in recent_deployments],
        recent_alerts=[AlertOut.model_validate(a) for a in recent_alerts],
        recent_runs=[PipelineRunOut.model_validate(r) for r in recent_runs],
        services=[ApplicationOut.model_validate(a) for a in services],
        generated_at=now,
    )
    cache_set(f"dashboard:summary:{range}", payload.model_dump(mode="json"), ttl_seconds=15)
    return payload


@router.get("/metrics")
def metrics(
    user: CurrentUser,
    db: DbDep,
    range: str = Query(default="1h", pattern="^(1h|24h|7d|30d)$"),
) -> dict:
    """Chart-only refresh endpoint used by the dashboard range selector."""
    start = since(range)
    samples = db.scalars(
        select(TelemetrySample)
        .where(TelemetrySample.ts >= start)
        .order_by(TelemetrySample.ts.asc())
    ).all()
    return {
        "data_source": "demo",
        "range": range,
        "points": downsample(samples),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
