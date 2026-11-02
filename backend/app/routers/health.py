"""Health and readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from .. import __version__
from ..config import settings
from ..database import engine
from ..ws import manager

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": __version__,
        "environment": settings.environment,
        "demo_mode": settings.demo_mode,
    }


@router.get("/health/ready")
def readiness() -> dict:
    checks: dict[str, str] = {}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # pragma: no cover - depends on environment
        checks["database"] = f"error: {type(exc).__name__}"

    checks["cache"] = "memory" if not settings.redis_url else "redis"
    checks["websocket_connections"] = str(manager.count)
    ready = checks["database"] == "ok"
    return {"status": "ready" if ready else "degraded", "checks": checks}
