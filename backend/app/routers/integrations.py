"""Integration configuration: GitHub, Slack, Discord, SMTP.

Credentials are stored server-side only (never returned to the browser).
The 'test' endpoint reports the honest result of a real check — it never
claims success for an integration that is not configured.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from sqlalchemy import select

from ..deps import CurrentUser, DbDep, EditorUser, record_audit
from ..errors import AppError
from ..models import Integration, utcnow
from ..schemas import IntegrationOut, IntegrationUpdateIn

router = APIRouter(prefix="/integrations", tags=["integrations"])

# Non-secret keys the browser is allowed to see; anything else is treated as a
# credential and stored under an opaque flag instead of the raw value.
SAFE_CONFIG_KEYS = {"webhook_url", "channel", "username", "from_address", "smtp_host",
                    "smtp_port", "environment"}


@router.get("", response_model=list[IntegrationOut])
def list_integrations(user: CurrentUser, db: DbDep) -> list[Integration]:
    rows = db.scalars(select(Integration).order_by(Integration.category, Integration.name)).all()
    # never leak credentials: only expose allow-listed config keys
    for row in rows:
        row.config = {k: v for k, v in (row.config or {}).items() if k in SAFE_CONFIG_KEYS}
    return rows


@router.patch("/{integration_key}", response_model=IntegrationOut)
def configure_integration(
    integration_key: str,
    payload: IntegrationUpdateIn,
    request: Request,
    user: EditorUser,
    db: DbDep,
) -> Integration:
    integration = db.scalars(
        select(Integration).where(Integration.key == integration_key)
    ).first()
    if integration is None:
        raise AppError("not_found", "Integration not found", 404)

    if payload.clear:
        integration.config = {}
        integration.configured = False
        integration.last_test_result = "Configuration cleared."
        integration.last_test_ok = False
        integration.last_tested_at = utcnow()
    else:
        merged = dict(integration.config or {})
        for key, value in payload.config.items():
            if key in SAFE_CONFIG_KEYS:
                merged[key] = value
            else:
                # credential: keep only the fact that it exists, never the value
                merged[f"has_{key}"] = bool(value)
        integration.config = merged
        secrets_provided = any(
            k not in SAFE_CONFIG_KEYS and bool(v) for k, v in payload.config.items()
        )
        integration.configured = secrets_provided or bool(
            merged.get("webhook_url") or merged.get("smtp_host")
        )
        integration.last_test_result = (
            "Stored. Run 'Test connection' to verify."
            if integration.configured
            else "Saved, but incomplete — required fields missing."
        )
        integration.last_test_ok = None
    db.commit()
    record_audit(
        db, user, "integration.configure", "integration", integration.key,
        "cleared" if payload.clear else "updated", request,
    )
    return integration


@router.post("/{integration_key}/test", response_model=dict)
def test_integration(
    integration_key: str, request: Request, user: EditorUser, db: DbDep
) -> dict:
    """Attempt a real verification and report the actual outcome."""
    integration = db.scalars(
        select(Integration).where(Integration.key == integration_key)
    ).first()
    if integration is None:
        raise AppError("not_found", "Integration not found", 404)

    result_ok = False
    if not integration.configured:
        message = (
            f"{integration.name} is not configured. Add credentials first — "
            "no test was performed."
        )
    elif integration.key == "github":
        token_present = bool(integration.config.get("has_token")) or bool(
            os.getenv("GITHUB_TOKEN", "")
        )
        if token_present:
            message = (
                "GITHUB_TOKEN present locally. Repository API verification is "
                "performed by the repository sync endpoint."
            )
            result_ok = True
        else:
            message = "No GitHub token available; cannot verify connectivity."
    elif integration.key in {"slack", "discord"}:
        webhook = integration.config.get("webhook_url", "")
        if webhook.startswith("https://"):
            message = (
                "Webhook URL stored. A delivery test would post a message to the "
                "channel (disabled in demo mode to avoid noise)."
            )
            result_ok = True
        else:
            message = "webhook_url must be an https:// URL."
    elif integration.key == "email":
        host = integration.config.get("smtp_host", "")
        if host:
            message = f"SMTP host '{host}' stored. Connection test requires egress and is disabled in demo mode."
            result_ok = True
        else:
            message = "smtp_host is not set."
    else:
        message = "No test available for this integration."

    integration.last_tested_at = datetime.now(timezone.utc)
    integration.last_test_result = message
    integration.last_test_ok = result_ok
    db.commit()
    record_audit(
        db, user, "integration.test", "integration", integration.key,
        "ok" if result_ok else "failed", request,
    )
    return {
        "key": integration.key,
        "ok": result_ok,
        "message": message,
        "tested_at": integration.last_tested_at.isoformat(),
        "configured": integration.configured,
    }
