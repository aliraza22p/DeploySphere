"""Monitoring agent endpoints.

Agents authenticate with a per-server token (X-Agent-Token header). The token
is stored hashed; it is only ever shown once at server registration and never
sent to the browser afterwards. Telemetry payloads are validated with Pydantic
before touching the database.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import settings
from ..deps import DbDep
from ..errors import AppError
from ..models import (
    AgentStatus,
    DataSource,
    LogRecord,
    LogSeverity,
    LogSource,
    Server,
    ServerStatus,
    TelemetrySample,
)
from ..security import verify_secret
from ..ws import manager

router = APIRouter(prefix="/agents", tags=["agents"])


class TelemetryPayload(BaseModel):
    hostname: str = Field(min_length=1, max_length=160)
    cpu_percent: float = Field(ge=0, le=100)
    memory_percent: float = Field(ge=0, le=100)
    disk_percent: float = Field(ge=0, le=100)
    network_in_mbps: float = Field(ge=0, le=100_000)
    network_out_mbps: float = Field(ge=0, le=100_000)
    uptime_seconds: int = Field(ge=0)
    agent_version: str = Field(default="1.0.0", max_length=40)
    services: list[dict] = Field(default_factory=list, max_length=50)


def _authenticate(db, token: str | None, hostname_hint: str = "") -> Server:
    if not token:
        raise AppError("unauthorized", "X-Agent-Token header is required", 401)
    # Look up by hashed token without leaking which part failed.
    candidates = db.scalars(
        select(Server).where(Server.agent_token_hash != "")
    ).all()
    for server in candidates:
        if verify_secret(token, server.agent_token_hash):
            if hostname_hint and server.hostname != hostname_hint:
                # token/hostname mismatch: still a valid token, but wrong host
                raise AppError(
                    "hostname_mismatch",
                    f"Token does not belong to host '{hostname_hint}'",
                    403,
                )
            return server
    raise AppError("unauthorized", "Invalid agent token", 401)


@router.get("/hello")
def agent_hello(db: DbDep, x_agent_token: str | None = Header(default=None)) -> dict:
    """Handshake: validates the token and returns the agent's configuration."""
    server = _authenticate(db, x_agent_token)
    return {
        "server_id": server.id,
        "name": server.name,
        "hostname": server.hostname,
        "collection_interval_seconds": server.collection_interval_seconds,
        "thresholds": {
            "cpu": server.cpu_threshold,
            "memory": server.memory_threshold,
            "disk": server.disk_threshold,
        },
        "demo_mode": settings.demo_mode,
        "agent_time": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/telemetry", status_code=202)
async def ingest_telemetry(
    payload: TelemetryPayload,
    request: Request,
    db: DbDep,
    x_agent_token: str | None = Header(default=None),
) -> dict:
    server = _authenticate(db, x_agent_token, hostname_hint=payload.hostname)

    now = datetime.now(timezone.utc)
    server.cpu_percent = round(payload.cpu_percent, 1)
    server.memory_percent = round(payload.memory_percent, 1)
    server.disk_percent = round(payload.disk_percent, 1)
    server.network_in_mbps = round(payload.network_in_mbps, 2)
    server.network_out_mbps = round(payload.network_out_mbps, 2)
    server.uptime_seconds = payload.uptime_seconds
    server.last_seen_at = now
    server.agent_status = AgentStatus.online

    # evaluate thresholds server-side so alerting does not depend on the browser
    breached = (
        server.cpu_percent >= server.cpu_threshold
        or server.memory_percent >= server.memory_threshold
        or server.disk_percent >= server.disk_threshold
    )
    server.status = ServerStatus.critical if breached else ServerStatus.healthy

    db.add(
        TelemetrySample(
            server_id=server.id,
            ts=now,
            cpu_percent=server.cpu_percent,
            memory_percent=server.memory_percent,
            disk_percent=server.disk_percent,
            network_in_mbps=server.network_in_mbps,
            network_out_mbps=server.network_out_mbps,
            uptime_seconds=server.uptime_seconds,
            source=DataSource.live,
        )
    )
    db.commit()

    await manager.broadcast(
        {
            "type": "metric.sample",
            "payload": {
                "server_id": server.id,
                "name": server.name,
                "status": server.status.value,
                "cpu": server.cpu_percent,
                "memory": server.memory_percent,
                "disk": server.disk_percent,
                "network_in": server.network_in_mbps,
                "network_out": server.network_out_mbps,
                "uptime_seconds": server.uptime_seconds,
                "source": "live",
                "ts": now.isoformat(),
            },
        }
    )
    return {"status": "accepted", "server_id": server.id, "server_time": now.isoformat()}


@router.post("/logs", status_code=202)
async def ingest_logs(
    payload: dict,
    db: DbDep,
    x_agent_token: str | None = Header(default=None),
) -> dict:
    """Agents ship structured log lines; secrets are redacted on ingest."""
    from ..security import redact_secrets

    server = _authenticate(db, x_agent_token, hostname_hint=str(payload.get("hostname", "")))
    entries = payload.get("entries") or []
    if not isinstance(entries, list) or len(entries) > 200:
        raise AppError("bad_request", "entries must be a list of at most 200 items", 400)
    stored = 0
    for entry in entries[:200]:
        if not isinstance(entry, dict):
            continue
        message = redact_secrets(str(entry.get("message", ""))[:4000])
        if not message:
            continue
        severity = str(entry.get("severity", "info")).lower()
        if severity not in {"debug", "info", "warning", "error", "critical"}:
            severity = "info"
        source = str(entry.get("source", "server")).lower()
        if source not in {"pipeline", "build", "deployment", "agent", "server", "application", "system"}:
            source = "server"
        db.add(
            LogRecord(
                ts=datetime.now(timezone.utc),
                source=LogSource(source),
                severity=LogSeverity(severity),
                message=message,
                server_id=server.id,
                source_data=DataSource.live,
            )
        )
        stored += 1
    db.commit()
    return {"status": "accepted", "stored": stored}
