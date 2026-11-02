"""Git repository integration: connect, inspect, webhook ingestion.

GitHub webhook deliveries are validated with HMAC (X-Hub-Signature-256),
duplicate deliveries are ignored via X-GitHub-Delivery, and out-of-order
events are handled by ignoring deliveries older than the last processed one
for the same repository.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import settings
from ..deps import CurrentUser, DbDep, EditorUser, record_audit
from ..errors import AppError
from ..models import (
    ConnectionStatus,
    DataSource,
    Pipeline,
    PipelineRun,
    PipelineStage,
    Repository,
    RunStatus,
    utcnow,
)
from ..schemas import RepositoryIn, RepositoryOut
from ..ws import manager

router = APIRouter(prefix="/repositories", tags=["repositories"])

# ---------------------------------------------------------------------------
# Webhook delivery bookkeeping (per-process; a multi-instance deployment
# should move this to Redis — see README "Scaling notes").
# ---------------------------------------------------------------------------
_seen_deliveries: dict[str, float] = {}
_last_event_ts: dict[str, float] = {}
_DEDUP_TTL = 60 * 60 * 6


def _remember_delivery(delivery_id: str) -> bool:
    """Returns False when this delivery id was already processed."""
    now = time.time()
    for key, ts in list(_seen_deliveries.items()):
        if now - ts > _DEDUP_TTL:
            _seen_deliveries.pop(key, None)
    if delivery_id in _seen_deliveries:
        return False
    _seen_deliveries[delivery_id] = now
    return True


class RepoEvent(BaseModel):
    """Minimal GitHub webhook payload subset we act on."""

    ref: str = ""
    after: str = "0"
    repository: dict = Field(default_factory=dict)
    head_commit: dict = Field(default_factory=dict)
    action: str = ""
    pull_request: dict = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# CRUD
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[RepositoryOut])
def list_repositories(user: CurrentUser, db: DbDep) -> list[Repository]:
    return db.scalars(select(Repository).order_by(Repository.full_name.asc())).all()


@router.post("", response_model=RepositoryOut, status_code=201)
def connect_repository(
    payload: RepositoryIn, request: Request, user: EditorUser, db: DbDep
) -> Repository:
    full_name = payload.full_name.strip()
    if db.scalars(select(Repository).where(Repository.full_name == full_name)).first():
        raise AppError("conflict", "Repository is already connected", 409)
    owner, _, name = full_name.partition("/")
    has_credentials = bool(settings.github_webhook_secret) or bool(
        __import__("os").getenv("GITHUB_TOKEN", "")
    )
    repo = Repository(
        name=name,
        full_name=full_name,
        owner=owner,
        default_branch=payload.default_branch,
        clone_url=payload.clone_url or f"https://github.com/{full_name}.git",
        connection_status=(
            ConnectionStatus.connected
            if has_credentials
            else ConnectionStatus.missing_credentials
        ),
        status_detail=(
            "Connected."
            if has_credentials
            else "Repository registered, but no GitHub credentials are configured. "
            "Set GITHUB_TOKEN and GITHUB_WEBHOOK_SECRET, then save the webhook URL "
            "shown on the repository detail page."
        ),
        webhook_configured=bool(settings.github_webhook_secret),
    )
    db.add(repo)
    db.commit()
    record_audit(
        db, user, "repository.connect", "repository", repo.id, full_name, request
    )
    return repo


@router.get("/{repo_id}", response_model=dict)
def repository_detail(repo_id: int, user: CurrentUser, db: DbDep) -> dict:
    repo = db.get(Repository, repo_id)
    if repo is None:
        raise AppError("not_found", "Repository not found", 404)
    pipelines = db.scalars(
        select(Pipeline).where(Pipeline.repository_id == repo.id).order_by(Pipeline.name)
    ).all()
    connected = repo.connection_status == ConnectionStatus.connected

    # Branches/commits: real data only with credentials; in demo mode a clearly
    # labelled sample set keeps the UI functional without GitHub access.
    if connected:
        branches: list[dict] = []
        commits: list[dict] = []
    elif settings.demo_mode:
        branches = [
            {"name": repo.default_branch, "protected": True, "source": "demo"},
            {"name": "develop", "protected": False, "source": "demo"},
            {"name": "release/2.15", "protected": True, "source": "demo"},
        ]
        commits = [
            {"sha": "a1b2c3d", "message": "feat: add checkout summary panel",
             "author": "dev@deploysphere.dev", "when": "2026-10-29T09:12:00Z", "source": "demo"},
            {"sha": "9f8e7d6", "message": "fix: prevent duplicate webhook processing",
             "author": "admin@deploysphere.dev", "when": "2026-10-28T16:40:00Z", "source": "demo"},
            {"sha": "55aa66b", "message": "chore: bump base image to 2026.10",
             "author": "ci@deploysphere.dev", "when": "2026-10-27T11:05:00Z", "source": "demo"},
        ]
    else:
        branches, commits = [], []

    return {
        "repository": RepositoryOut.model_validate(repo),
        "branches": branches,
        "commits": commits,
        "pipelines": [
            {
                "id": p.id,
                "name": p.name,
                "branch": p.branch,
                "enabled": p.enabled,
                "environment": p.environment.value,
            }
            for p in pipelines
        ],
        "webhook": {
            "configured": repo.webhook_configured,
            "url": f"{request_base_url()}/api/v1/repositories/webhook/github",
            "events": ["push", "pull_request"],
            "signature_header": "X-Hub-Signature-256",
        },
        "setup_guidance": None
        if connected
        else [
            "Create a fine-grained personal access token with Contents:Read and "
            "Webhooks:Read/Write permissions.",
            "Set GITHUB_TOKEN in the backend environment (.env).",
            "Set GITHUB_WEBHOOK_SECRET to a long random string and use it as the "
            "webhook secret in GitHub.",
            "Paste the webhook URL above into GitHub → Settings → Webhooks.",
            "Until then, demo mode serves clearly labelled sample branches and commits.",
        ],
        "data_source": "live" if connected else ("demo" if settings.demo_mode else "none"),
    }


@router.patch("/{repo_id}", response_model=RepositoryOut)
def update_repository(
    repo_id: int, payload: RepositoryIn, request: Request, user: EditorUser, db: DbDep
) -> Repository:
    repo = db.get(Repository, repo_id)
    if repo is None:
        raise AppError("not_found", "Repository not found", 404)
    repo.default_branch = payload.default_branch
    if payload.clone_url:
        repo.clone_url = payload.clone_url
    db.commit()
    record_audit(
        db, user, "repository.update", "repository", repo.id, payload.full_name, request
    )
    return repo


@router.delete("/{repo_id}", status_code=204)
def disconnect_repository(repo_id: int, request: Request, user: EditorUser, db: DbDep) -> None:
    repo = db.get(Repository, repo_id)
    if repo is None:
        raise AppError("not_found", "Repository not found", 404)
    record_audit(
        db, user, "repository.disconnect", "repository", repo.id, repo.full_name, request
    )
    db.delete(repo)
    db.commit()


@router.post("/{repo_id}/sync", response_model=dict)
def sync_repository(repo_id: int, request: Request, user: EditorUser, db: DbDep) -> dict:
    """Refresh connection status; reports the honest result of the check."""
    repo = db.get(Repository, repo_id)
    if repo is None:
        raise AppError("not_found", "Repository not found", 404)
    import os

    has_token = bool(os.getenv("GITHUB_TOKEN", ""))
    if has_token:
        repo.connection_status = ConnectionStatus.connected
        repo.status_detail = "Credentials present. Webhook deliveries will appear here."
        repo.last_event_at = utcnow()
    else:
        repo.connection_status = ConnectionStatus.missing_credentials
        repo.status_detail = (
            "Still no GITHUB_TOKEN configured — running in demo mode with "
            "simulated repository events."
        )
    db.commit()
    record_audit(db, user, "repository.sync", "repository", repo.id, "", request)
    return {
        "connection_status": repo.connection_status.value,
        "status_detail": repo.status_detail,
        "data_source": "live" if has_token else "demo",
    }


# --------------------------------------------------------------------------- #
# Webhook ingestion (unauthenticated endpoint; signature-verified)
# --------------------------------------------------------------------------- #


def request_base_url() -> str:
    import os

    return os.getenv("PUBLIC_API_BASE_URL", "http://localhost:8000").rstrip("/")


@router.post("/webhook/github", status_code=202)
async def github_webhook(
    request: Request,
    payload: bytes = None,  # type: ignore[assignment]
    x_hub_signature_256: str | None = Header(default=None),
    x_github_delivery: str | None = Header(default=None),
    x_github_event: str | None = Header(default=None),
    x_github_hook_id: str | None = Header(default=None),
) -> dict:
    body = await request.body()

    if not settings.github_webhook_secret:
        raise HTTPException(
            status_code=409,
            detail={
                "error": {
                    "code": "webhook_not_configured",
                    "message": "GITHUB_WEBHOOK_SECRET is not configured; deliveries are "
                    "rejected until the webhook is set up.",
                    "details": [],
                    "request_id": "",
                }
            },
        )

    if not x_hub_signature_256:
        raise HTTPException(status_code=401, detail="Missing X-Hub-Signature-256")
    expected = "sha256=" + hmac.new(
        settings.github_webhook_secret.encode(), body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # duplicate delivery handling
    if x_github_delivery and not _remember_delivery(x_github_delivery):
        return {"status": "duplicate", "delivery": x_github_delivery}

    import json

    try:
        event = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = x_github_event or ""
    repo_full_name = (event.get("repository") or {}).get("full_name", "")

    db = next(request.app.state.db_dependency())
    try:
        repo = db.scalars(
            select(Repository).where(Repository.full_name == repo_full_name)
        ).first()
        if repo is None:
            return {"status": "ignored", "reason": "repository not connected"}

        # out-of-order protection: ignore events older than the last processed
        received = float(event.get("repository", {}).get("pushed_at_ts", 0) or 0)
        last = _last_event_ts.get(repo.full_name, 0.0)
        if received and received < last:
            return {"status": "ignored", "reason": "out-of-order event"}
        _last_event_ts[repo.full_name] = max(last, received or time.time())

        repo.last_event_at = utcnow()

        triggered: list[int] = []
        if event_type == "push":
            ref = event.get("ref", "")
            branch = ref.removeprefix("refs/heads/") if ref else ""
            head = event.get("head_commit") or {}
            pipelines = db.scalars(
                select(Pipeline).where(
                    Pipeline.repository_id == repo.id,
                    Pipeline.enabled.is_(True),
                )
            ).all()
            for pipeline in pipelines:
                if "push" not in (pipeline.triggers or []):
                    continue
                if branch and pipeline.branch != branch:
                    continue
                run = _enqueue_run(
                    db, pipeline, event.get("after", "")[:40],
                    str(head.get("message", ""))[:255], branch or pipeline.branch,
                    "webhook",
                )
                if run is not None:
                    triggered.append(run)
        db.commit()
    finally:
        db.close()

    for run_id in triggered:
        await manager.broadcast(
            {
                "type": "pipeline.run.updated",
                "payload": {
                    "run_id": run_id,
                    "status": "queued",
                    "trigger": "webhook",
                    "source": "live",
                }
            }
        )
    return {
        "status": "processed",
        "event": event_type,
        "repository": repo_full_name,
        "pipelines_triggered": triggered,
    }


def _enqueue_run(db, pipeline: Pipeline, sha: str, message: str, branch: str,
                 trigger: str) -> int | None:
    from sqlalchemy import func

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
        commit_sha=sha or "0" * 40,
        commit_message=message,
        branch=branch,
        triggered_by="github-webhook",
        trigger_event=trigger,
        source=DataSource.live if settings.github_webhook_secret else DataSource.demo,
    )
    db.add(run)
    db.flush()
    for index, stage in enumerate(pipeline.stages or []):
        db.add(
            PipelineStage(
                run_id=run.id,
                key=stage.get("key", f"stage_{index}"),
                name=stage.get("name", f"Stage {index + 1}"),
                position=index,
                status=RunStatus.queued,
            )
        )
    return run.id
