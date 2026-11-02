"""Platform settings (single row) and the demo reset control."""

from __future__ import annotations

from fastapi import APIRouter, Request
from sqlalchemy import select

from ..config import settings as app_settings
from ..deps import AdminUser, CurrentUser, DbDep, record_audit
from ..errors import AppError
from ..models import AppSettings, utcnow
from ..schemas import SettingsOut, SettingsUpdateIn
from ..cache import cache_clear

router = APIRouter(prefix="/settings", tags=["settings"])


def _row(db) -> AppSettings:
    row = db.scalars(select(AppSettings).limit(1)).first()
    if row is None:
        row = AppSettings()
        db.add(row)
        db.commit()
    return row


@router.get("", response_model=SettingsOut)
def get_settings(user: CurrentUser, db: DbDep) -> AppSettings:
    return _row(db)


@router.patch("", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdateIn, request: Request, user: AdminUser, db: DbDep
) -> AppSettings:
    row = _row(db)
    changed = payload.model_dump(exclude_unset=True)
    for key, value in changed.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    db.commit()
    cache_clear()
    record_audit(
        db, user, "settings.update", "settings", row.id,
        ", ".join(f"{k}={v}" for k, v in changed.items()), request,
    )
    return row


@router.post("/demo/reset", response_model=dict)
def reset_demo(request: Request, user: AdminUser, db: DbDep) -> dict:
    """Reset the demo environment to freshly-generated sample data."""
    if not app_settings.demo_mode:
        raise AppError(
            "demo_disabled",
            "Demo mode is disabled; re-enable it in Settings before resetting.",
            409,
        )
    from ..seed import reset_demo_data

    summary = reset_demo_data(db)
    cache_clear()
    record_audit(
        db, user, "demo.reset", "settings", "", f"Re-seeded: {summary}", request
    )
    return {"status": "reset", "seeded": summary}
