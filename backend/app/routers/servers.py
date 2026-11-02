"""Server registration, management and telemetry queries."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from ..deps import CurrentUser, DbDep, EditorUser, record_audit
from ..errors import AppError
from ..models import (
    AgentStatus,
    DataSource,
    Environment,
    Server,
    ServerStatus,
    TelemetrySample,
)
from ..schemas import Page, ServerCreated, ServerIn, ServerOut, ServerUpdateIn, TelemetrySeries
from ..security import generate_secret, hash_secret
from ..series import downsample, since, uptime_bucket

router = APIRouter(prefix="/servers", tags=["servers"])


@router.get("", response_model=Page[ServerOut])
def list_servers(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status: str | None = None,
    q: str | None = None,
) -> Page[ServerOut]:
    stmt = select(Server)
    if status:
        try:
            stmt = stmt.where(Server.status == ServerStatus(status))
        except ValueError:
            raise AppError("bad_status", f"Unknown status '{status}'", 400)
    if q:
        stmt = stmt.where(Server.name.ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(Server.name.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return Page(items=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=ServerCreated, status_code=201)
def create_server(
    payload: ServerIn, request: Request, user: EditorUser, db: DbDep
) -> ServerCreated:
    exists = db.scalars(
        select(Server).where(
            (Server.hostname == payload.hostname) | (Server.name == payload.name)
        )
    ).first()
    if exists is not None:
        raise AppError("conflict", "A server with this name or hostname already exists", 409)
    agent_token = generate_secret("dps_")
    fields = payload.model_dump()
    fields["environment"] = Environment(payload.environment)
    server = Server(
        **fields,
        agent_token_hash=hash_secret(agent_token),
        status=ServerStatus.offline,
        agent_status=AgentStatus.offline,
    )
    db.add(server)
    db.commit()
    record_audit(
        db, user, "server.create", "server", server.id, f"{server.name} ({server.hostname})", request
    )
    out = ServerCreated.model_validate(server)
    out.agent_token = agent_token
    out.agent_token_warning = (
        "Copy this agent token now: it is stored hashed and cannot be shown again. "
        "Provide it to the monitoring agent as DEPLOYSPHERE_AGENT_TOKEN."
    )
    return out


@router.get("/{server_id}", response_model=ServerOut)
def get_server(server_id: int, user: CurrentUser, db: DbDep) -> Server:
    server = db.get(Server, server_id)
    if server is None:
        raise AppError("not_found", "Server not found", 404)
    return server


@router.patch("/{server_id}", response_model=ServerOut)
def update_server(
    server_id: int, payload: ServerUpdateIn, request: Request, user: EditorUser, db: DbDep
) -> Server:
    server = db.get(Server, server_id)
    if server is None:
        raise AppError("not_found", "Server not found", 404)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, key, value)
    db.commit()
    record_audit(db, user, "server.update", "server", server.id, ", ".join(payload.model_dump(exclude_unset=True).keys()), request)
    return server


@router.delete("/{server_id}", status_code=204)
def delete_server(server_id: int, request: Request, user: EditorUser, db: DbDep) -> None:
    server = db.get(Server, server_id)
    if server is None:
        raise AppError("not_found", "Server not found", 404)
    record_audit(db, user, "server.delete", "server", server.id, server.name, request)
    db.delete(server)
    db.commit()


@router.post("/{server_id}/rotate-agent-token")
def rotate_token(
    server_id: int, request: Request, user: EditorUser, db: DbDep
) -> dict:
    server = db.get(Server, server_id)
    if server is None:
        raise AppError("not_found", "Server not found", 404)
    token = generate_secret("dps_")
    server.agent_token_hash = hash_secret(token)
    db.commit()
    record_audit(db, user, "server.agent_token_rotate", "server", server.id, "", request)
    return {
        "server_id": server.id,
        "agent_token": token,
        "warning": "Previous token is now invalid. Update the agent and restart it.",
    }


@router.get("/{server_id}/metrics", response_model=TelemetrySeries)
def server_metrics(
    server_id: int,
    user: CurrentUser,
    db: DbDep,
    range: str = Query(default="24h", pattern="^(1h|24h|7d|30d)$"),
) -> TelemetrySeries:
    server = db.get(Server, server_id)
    if server is None:
        raise AppError("not_found", "Server not found", 404)
    start = since(range)
    samples = db.scalars(
        select(TelemetrySample)
        .where(TelemetrySample.server_id == server_id, TelemetrySample.ts >= start)
        .order_by(TelemetrySample.ts.asc())
    ).all()
    return TelemetrySeries(
        data_source="demo" if samples and samples[0].source == DataSource.demo else "live",
        range=range,
        points=downsample(samples),
    )


@router.get("/{server_id}/summary")
def server_summary(server_id: int, user: CurrentUser, db: DbDep) -> dict:
    """Status, freshness and derived uptime used by the server detail page."""
    server = db.get(Server, server_id)
    if server is None:
        raise AppError("not_found", "Server not found", 404)
    now = datetime.now(timezone.utc)
    freshness_seconds = None
    if server.last_seen_at is not None:
        seen = server.last_seen_at
        if seen.tzinfo is None:
            seen = seen.replace(tzinfo=timezone.utc)
        freshness_seconds = int((now - seen).total_seconds())
    thresholds_breached = {
        "cpu": server.cpu_percent >= server.cpu_threshold,
        "memory": server.memory_percent >= server.memory_threshold,
        "disk": server.disk_percent >= server.disk_threshold,
    }
    return {
        "server": ServerOut.model_validate(server),
        "uptime": uptime_bucket(server.uptime_seconds),
        "freshness_seconds": freshness_seconds,
        "thresholds_breached": thresholds_breached,
        "agent_online": server.agent_status == AgentStatus.online,
        "sample_count": db.scalar(
            select(func.count()).select_from(TelemetrySample).where(
                TelemetrySample.server_id == server_id
            )
        )
        or 0,
    }
