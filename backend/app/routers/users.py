"""Team management: list, invite, change role, deactivate."""

from __future__ import annotations

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from ..deps import AdminUser, DbDep, record_audit
from ..errors import AppError
from ..models import User, UserRole
from ..schemas import InviteUserIn, Page, UserOut, UserUpdateIn
from ..security import generate_secret, hash_password

router = APIRouter(prefix="/users", tags=["team"])


@router.get("", response_model=Page[UserOut])
def list_users(
    admin: AdminUser,
    db: DbDep,
    page: int = 1,
    page_size: int = 50,
    q: str | None = None,
) -> Page[UserOut]:
    stmt = select(User)
    if q:
        stmt = stmt.where(User.email.ilike(f"%{q}%") | User.full_name.ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(User.created_at.asc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(items=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=dict, status_code=201)
def invite_user(payload: InviteUserIn, request: Request, admin: AdminUser, db: DbDep) -> dict:
    """Invite a teammate.

    In demo mode the one-time temporary password is returned so the flow can be
    completed without an SMTP server; otherwise it is treated as emailed.
    """
    from ..config import settings

    email = payload.email.lower()
    if db.scalars(select(User).where(User.email == email)).first():
        raise AppError("conflict", "A user with this email already exists", 409)
    temp_password = generate_secret("Invite!")
    user = User(
        email=email,
        full_name=payload.full_name,
        password_hash=hash_password(temp_password),
        role=UserRole(payload.role),
        is_active=True,
    )
    db.add(user)
    db.commit()
    record_audit(db, admin, "user.invite", "user", user.id, f"{email} as {payload.role}", request)
    return {
        "user": UserOut.model_validate(user).model_dump(mode="json"),
        "temporary_password": temp_password if settings.demo_mode else None,
        "message": (
            "Invited (demo mode: temporary password returned here once)."
            if settings.demo_mode
            else "Invitation e-mail queued."
        ),
    }


@router.post("/{user_id}/invite-reset", response_model=dict)
def issue_invite_password(
    user_id: int, request: Request, admin: AdminUser, db: DbDep
) -> dict:
    """Return a one-time temporary password (demo mode stand-in for e-mail)."""
    from ..config import settings

    user = db.get(User, user_id)
    if user is None:
        raise AppError("not_found", "User not found", 404)
    temp_password = generate_secret("Invite!")
    user.password_hash = hash_password(temp_password)
    db.commit()
    record_audit(db, admin, "user.password_reset", "user", user.id, "", request)
    return {
        "user_id": user.id,
        "demo_mode": settings.demo_mode,
        "temporary_password": temp_password if settings.demo_mode else None,
        "message": (
            "Temporary password generated (demo mode: shown here once)."
            if settings.demo_mode
            else "Password reset email queued."
        ),
    }


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, payload: UserUpdateIn, request: Request, admin: AdminUser, db: DbDep
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AppError("not_found", "User not found", 404)
    changed = payload.model_dump(exclude_unset=True)
    if changed.get("is_active") is False and user.id == admin.id:
        raise AppError("conflict", "You cannot deactivate your own account", 409)
    if "role" in changed and changed["role"]:
        if user.id == admin.id and changed["role"] != UserRole.administrator.value:
            raise AppError("conflict", "You cannot demote your own account", 409)
        changed["role"] = UserRole(changed["role"])
    for key, value in changed.items():
        setattr(user, key, value)
    db.commit()
    record_audit(
        db, admin, "user.update", "user", user.id,
        ", ".join(f"{k}={v}" for k, v in changed.items()), request,
    )
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request, admin: AdminUser, db: DbDep) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise AppError("not_found", "User not found", 404)
    if user.id == admin.id:
        raise AppError("conflict", "You cannot delete your own account", 409)
    record_audit(db, admin, "user.delete", "user", user.id, user.email, request)
    db.delete(user)
    db.commit()
