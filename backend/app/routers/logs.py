"""Centralized log explorer: search, filters, pagination and safe export."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import func, or_, select

from ..deps import CurrentUser, DbDep, record_audit
from ..errors import AppError
from ..models import LogRecord, LogSeverity, LogSource
from ..schemas import LogOut, Page
from ..security import redact_secrets

router = APIRouter(prefix="/logs", tags=["logs"])


def _filtered(stmt, q: str | None, source: str | None, severity: str | None,
              server_id: int | None, run_id: int | None, deployment_id: int | None,
              data_source: str | None, ts_from: datetime | None, ts_to: datetime | None):
    if source:
        try:
            stmt = stmt.where(LogRecord.source == LogSource(source))
        except ValueError:
            raise AppError("bad_source", f"Unknown log source '{source}'", 400)
    if severity:
        try:
            stmt = stmt.where(LogRecord.severity == LogSeverity(severity))
        except ValueError:
            raise AppError("bad_severity", f"Unknown severity '{severity}'", 400)
    if server_id:
        stmt = stmt.where(LogRecord.server_id == server_id)
    if run_id:
        stmt = stmt.where(LogRecord.pipeline_run_id == run_id)
    if deployment_id:
        stmt = stmt.where(LogRecord.deployment_id == deployment_id)
    if data_source:
        stmt = stmt.where(LogRecord.source_data == data_source)
    if ts_from:
        stmt = stmt.where(LogRecord.ts >= ts_from)
    if ts_to:
        stmt = stmt.where(LogRecord.ts <= ts_to)
    if q:
        stmt = stmt.where(
            or_(LogRecord.message.ilike(f"%{q}%"), LogRecord.trace_id.ilike(f"%{q}%"))
        )
    return stmt


@router.get("", response_model=Page[LogOut])
def list_logs(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    q: str | None = None,
    source: str | None = None,
    severity: str | None = None,
    server_id: int | None = None,
    pipeline_run_id: int | None = None,
    deployment_id: int | None = None,
    data_source: str | None = None,
    ts_from: datetime | None = Query(default=None, alias="from"),
    ts_to: datetime | None = Query(default=None, alias="to"),
) -> Page[LogOut]:
    stmt = _filtered(
        select(LogRecord), q, source, severity, server_id, pipeline_run_id,
        deployment_id, data_source, ts_from, ts_to,
    )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(LogRecord.ts.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page(items=rows, total=total, page=page, page_size=page_size)


@router.get("/export")
def export_logs(
    request: Request,
    user: CurrentUser,
    db: DbDep,
    q: str | None = None,
    source: str | None = None,
    severity: str | None = None,
    server_id: int | None = None,
    data_source: str | None = None,
    limit: int = Query(5000, ge=1, le=20000),
) -> Response:
    """Download filtered logs as CSV (secrets are redacted on the way out)."""
    stmt = _filtered(
        select(LogRecord), q, source, severity, server_id, None, None,
        data_source, None, None,
    )
    rows = db.scalars(
        stmt.order_by(LogRecord.ts.desc()).limit(limit)
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["timestamp", "severity", "source", "data_source", "server_id",
                     "pipeline_run_id", "deployment_id", "trace_id", "message"])
    for row in rows:
        writer.writerow([
            row.ts.isoformat() if row.ts else "",
            row.severity.value,
            row.source.value,
            row.source_data.value,
            row.server_id or "",
            row.pipeline_run_id or "",
            row.deployment_id or "",
            row.trace_id,
            redact_secrets(row.message).replace("\n", " "),
        ])
    record_audit(
        db, user, "logs.export", "log_record", "", f"{len(rows)} rows", request
    )
    filename = f"deploysphere-logs-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
