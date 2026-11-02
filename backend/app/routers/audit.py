"""Audit log: who did what, when, and where from."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from ..deps import CurrentUser, DbDep
from ..models import AuditEvent
from ..schemas import AuditOut, Page

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=Page[AuditOut])
def list_audit_events(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    hours: int | None = Query(None, ge=1, le=720),
    action: str | None = None,
    actor: str | None = None,
    q: str | None = None,
) -> Page[AuditOut]:
    stmt = select(AuditEvent)
    if hours is not None:
        stmt = stmt.where(
            AuditEvent.created_at >= datetime.now(timezone.utc) - timedelta(hours=hours)
        )
    if action:
        stmt = stmt.where(AuditEvent.action.ilike(f"{action}%"))
    if actor:
        stmt = stmt.where(AuditEvent.actor_email == actor)
    if q:
        stmt = stmt.where(
            or_(
                AuditEvent.detail.ilike(f"%{q}%"),
                AuditEvent.resource_type.ilike(f"%{q}%"),
                AuditEvent.resource_id.ilike(f"%{q}%"),
                AuditEvent.actor_email.ilike(f"%{q}%"),
                AuditEvent.action.ilike(f"%{q}%"),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AuditEvent.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page(items=rows, total=total, page=page, page_size=page_size)
