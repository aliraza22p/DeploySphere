"""DeploySphere FastAPI application entry point.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from . import __version__
from .config import settings
from .database import SessionLocal, init_db
from .errors import install_error_handlers
from .models import User
from .routers import (
    agents,
    alerts,
    applications,
    auth,
    audit,
    dashboard,
    deployments,
    health,
    integrations,
    logs,
    pipelines,
    repositories,
    servers,
    settings as settings_router,
    users,
)
from .security import decode_token
from .simulator import simulator
from .ws import manager

# --------------------------------------------------------------------------- #
# Structured JSON logging (spec §2)
# --------------------------------------------------------------------------- #


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        extra = getattr(record, "extra_fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


logger = logging.getLogger("deploysphere.access")


# --------------------------------------------------------------------------- #
# Lifespan: init db, seed demo data, start/stop the simulator
# --------------------------------------------------------------------------- #


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    init_db()
    db = SessionLocal()
    try:
        from .seed import needs_seed, seed_demo_data

        if needs_seed(db):
            summary = seed_demo_data(db)
            logger.info(
                "database seeded with demo data",
                extra={"extra_fields": {"seeded": summary, "demo_mode": settings.demo_mode}},
            )
    finally:
        db.close()

    await simulator.start()
    logger.info(
        "backend started",
        extra={
            "extra_fields": {
                "version": __version__,
                "environment": settings.environment,
                "demo_mode": settings.demo_mode,
            }
        },
    )
    try:
        yield
    finally:
        await simulator.stop()
        logger.info("backend shutting down cleanly")
        # dispose engine connections for graceful shutdown
        from .database import engine

        engine.dispose()


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #

app = FastAPI(
    title="DeploySphere API",
    version=__version__,
    description=(
        "Automated DevOps deployment pipeline & monitoring platform. "
        "All demo/simulated data is labelled with source='demo'."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # narrow allowlist from env
    allow_credentials=settings.allow_credentials,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Agent-Token"],
)

install_error_handlers(app)


@app.middleware("http")
async def access_log(request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    duration_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "request",
        extra={
            "extra_fields": {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
                "request_id": getattr(request.state, "request_id", ""),
            }
        },
    )
    return response


API_PREFIX = "/api/v1"

app.include_router(health.router, prefix=API_PREFIX)
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(dashboard.router, prefix=API_PREFIX)
app.include_router(pipelines.router, prefix=API_PREFIX)
app.include_router(servers.router, prefix=API_PREFIX)
app.include_router(applications.router, prefix=API_PREFIX)
app.include_router(deployments.router, prefix=API_PREFIX)
app.include_router(alerts.router, prefix=API_PREFIX)
app.include_router(logs.router, prefix=API_PREFIX)
app.include_router(repositories.router, prefix=API_PREFIX)
app.include_router(users.router, prefix=API_PREFIX)
app.include_router(integrations.router, prefix=API_PREFIX)
app.include_router(settings_router.router, prefix=API_PREFIX)
app.include_router(audit.router, prefix=API_PREFIX)
app.include_router(agents.router, prefix=API_PREFIX)


@app.get("/")
def root() -> dict:
    return {
        "service": settings.app_name,
        "version": __version__,
        "api": API_PREFIX,
        "docs": "/docs",
        "websocket": "/ws/events",
        "demo_mode": settings.demo_mode,
    }


# --------------------------------------------------------------------------- #
# WebSocket: /ws/events?token=<access token>
# --------------------------------------------------------------------------- #


@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token") or ""
    email = ""
    try:
        payload = decode_token(token, expected_type="access")
        email = str(payload.get("sub", ""))
    except Exception:
        await websocket.close(code=4401, reason="invalid or missing token")
        return

    db = SessionLocal()
    try:
        user = db.scalars(select(User).where(User.email == email)).first()
        if user is None or not user.is_active:
            await websocket.close(code=4401, reason="account not found or disabled")
            return
    finally:
        db.close()

    conn = await manager.connect(websocket, email)
    try:
        await websocket.send_json(
            {
                "type": "connected",
                "payload": {
                    "user": email,
                    "demo_mode": settings.demo_mode,
                    "server_time": datetime.now(timezone.utc).isoformat(),
                },
            }
        )
        while True:
            # clients may send pings; ignore payloads
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await manager.disconnect(conn)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
