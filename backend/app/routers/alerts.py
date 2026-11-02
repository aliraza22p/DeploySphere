"""Alerts: listing, statistics, acknowledgement, resolution and muting."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from ..deps import CurrentUser, DbDep, EditorUser, record_audit
from ..errors import AppError
from ..models import (
    Alert,
    AlertSeverity,
    AlertStatus,
    Application,
    Server,
    utcnow,
)
from ..schemas import AlertActionIn, AlertCreateIn, AlertOut, Page
from ..ws import manager

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=Page[AlertOut])
def list_alerts(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    severity: str | None = None,
    status: str | None = None,
    server_id: int | None = None,
    q: str | None = None,
) -> Page[AlertOut]:
    stmt = select(Alert)
    if severity:
        try:
            stmt = stmt.where(Alert.severity == AlertSeverity(severity))
        except ValueError:
            raise AppError("bad_severity", f"Unknown severity '{severity}'", 400)
    if status:
        try:
            stmt = stmt.where(Alert.status == AlertStatus(status))
        except ValueError:
            raise AppError("bad_status", f"Unknown status '{status}'", 400)
    if server_id:
        stmt = stmt.where(Alert.server_id == server_id)
    if q:
        stmt = stmt.where(
            or_(Alert.title.ilike(f"%{q}%"), Alert.description.ilike(f"%{q}%"))
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Alert.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(items=rows, total=total, page=page, page_size=page_size)


@router.get("/stats")
def alert_stats(user: CurrentUser, db: DbDep) -> dict:
    """Counts by severity and status for the alerts summary cards."""
    by_severity = dict(
        db.execute(
            select(Alert.severity, func.count())
            .where(Alert.status.in_([AlertStatus.open, AlertStatus.acknowledged, AlertStatus.muted]))
            .group_by(Alert.severity)
        ).all()
    )
    by_status = dict(db.execute(select(Alert.status, func.count()).group_by(Alert.status)).all())
    return {
        "open": by_status.get(AlertStatus.open, 0),
        "acknowledged": by_status.get(AlertStatus.acknowledged, 0),
        "muted": by_status.get(AlertStatus.muted, 0),
        "resolved": by_status.get(AlertStatus.resolved, 0),
        "critical": by_severity.get(AlertSeverity.critical, 0),
        "warning": by_severity.get(AlertSeverity.warning, 0),
        "info": by_severity.get(AlertSeverity.info, 0),
        "total": sum(by_status.values()),
    }


@router.post("", response_model=AlertOut, status_code=201)
def create_alert(
    payload: AlertCreateIn, request: Request, user: EditorUser, db: DbDep
) -> Alert:
    if payload.server_id and db.get(Server, payload.server_id) is None:
        raise AppError("not_found", "Server not found", 404)
    if payload.application_id and db.get(Application, payload.application_id) is None:
        raise AppError("not_found", "Application not found", 404)
    alert = Alert(
        title=payload.title,
        description=payload.description,
        severity=AlertSeverity(payload.severity),
        status=AlertStatus.open,
        source="manual",
        server_id=payload.server_id,
        application_id=payload.application_id,
        suggested_action=payload.suggested_action,
        dedup_key=f"manual:{payload.title.lower()[:120]}",
    )
    db.add(alert)
    db.commit()
    record_audit(db, user, "alert.create", "alert", alert.id, alert.title, request)
    return alert


@router.patch("/{alert_id}", response_model=AlertOut)
async def act_on_alert(
    alert_id: int, payload: AlertActionIn, request: Request, user: CurrentUser, db: DbDep
) -> Alert:
    """Acknowledge, resolve, mute or reopen an alert.

    Availability is enforced server-side: viewers may acknowledge, everything
    else requires developer/admin (spec §11: validate authorization on the
    server, not only in the UI).
    """
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise AppError("not_found", "Alert not found", 404)

    action = payload.action
    if action != "acknowledge" and user.role.value == "viewer":
        raise AppError(
            "forbidden",
            "Viewers may only acknowledge alerts. Resolve/mute requires developer access.",
            403,
        )
    if action == "acknowledge":
        if alert.status in {AlertStatus.acknowledged, AlertStatus.resolved}:
            raise AppError("conflict", f"Alert is already {alert.status.value}", 409)
        alert.status = AlertStatus.acknowledged
        alert.acknowledged_by = user.email
        alert.acknowledged_at = utcnow()
    elif action == "resolve":
        if alert.status == AlertStatus.resolved:
            raise AppError("conflict", "Alert is already resolved", 409)
        alert.status = AlertStatus.resolved
        alert.resolved_at = utcnow()
    elif action == "mute":
        minutes = payload.mute_minutes or 60
        alert.status = AlertStatus.muted
        alert.muted_until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    elif action == "reopen":
        alert.status = AlertStatus.open
        alert.resolved_at = None
        alert.muted_until = None
        alert.acknowledged_at = None
        alert.acknowledged_by = ""
    db.commit()
    record_audit(
        db, user, f"alert.{action}", "alert", alert.id, alert.title, request
    )
    await manager.broadcast(
        {
            "type": "alert.updated",
            "payload": {
                "alert_id": alert.id,
                "status": alert.status.value,
                "severity": alert.severity.value,
                "title": alert.title,
                "actor": user.email,
            },
        }
    )
    return alert
