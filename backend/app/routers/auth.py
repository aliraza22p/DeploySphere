"""Authentication endpoints: register, login, refresh, logout, password reset."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..deps import CurrentUser, DbDep, check_rate_limit, record_audit
from ..config import settings
from ..errors import AppError
from ..models import User, UserRole, utcnow
from ..schemas import (
    ForgotPasswordIn,
    LoginIn,
    ProfileUpdateIn,
    RegisterIn,
    ResetPasswordIn,
    TokenOut,
    UserOut,
)
from ..security import create_token, decode_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class RefreshIn(BaseModel):
    refresh_token: str


@router.post("/register", response_model=TokenOut, status_code=201)
def register(payload: RegisterIn, request: Request, db: DbDep) -> TokenOut:
    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise AppError("conflict", "An account with this email already exists", 409)
    existing = db.query(User).count()
    user = User(
        email=email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        # first account becomes administrator (least surprise on fresh installs)
        role=UserRole.administrator if existing == 0 else UserRole.developer,
    )
    db.add(user)
    db.commit()
    record_audit(db, user, "user.register", "user", user.id, "Self-registration", request)
    return _issue_tokens(user)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: DbDep) -> TokenOut:
    ip = request.client.host if request.client else "unknown"
    email = payload.email.lower()
    check_rate_limit(
        f"login:{ip}:{email}",
        settings.login_rate_limit,
        settings.login_rate_window_seconds,
    )
    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        # constant-ish message: never reveal which part was wrong
        raise AppError("invalid_credentials", "Invalid email or password", 401)
    if not user.is_active:
        raise AppError("account_disabled", "This account has been disabled", 403)
    user.last_login_at = utcnow()
    db.commit()
    record_audit(db, user, "auth.login", "user", user.id, "Interactive login", request)
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenOut)
def refresh(payload: RefreshIn, db: DbDep) -> TokenOut:
    try:
        data = decode_token(payload.refresh_token, expected_type="refresh")
    except jwt.PyJWTError:
        raise AppError("unauthorized", "Invalid or expired refresh token", 401)
    user = db.query(User).filter(User.email == data.get("sub", "")).first()
    if user is None or not user.is_active:
        raise AppError("unauthorized", "Account not found or disabled", 401)
    return _issue_tokens(user)


@router.post("/logout", status_code=204)
def logout(request: Request, user: CurrentUser, db: DbDep) -> None:
    record_audit(db, user, "auth.logout", "user", user.id, "Interactive logout", request)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordIn, db: DbDep) -> dict:
    """Always answers 200 (no account enumeration).

    In demo mode the reset token is returned directly and flagged as such so
    the UI can complete the flow without a mail server. With real SMTP
    configured the token is delivered by e-mail and never returned.
    """
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    response: dict = {
        "status": "accepted",
        "message": "If an account exists for this address, a reset link has been sent.",
        "demo_mode": settings.demo_mode,
    }
    if user is not None and settings.demo_mode:
        response["demo_reset_token"] = create_token(
            user.email, token_type="reset", expires_minutes=30
        )
    return response


@router.post("/reset-password", response_model=dict)
def reset_password(payload: ResetPasswordIn, request: Request, db: DbDep) -> dict:
    try:
        data = decode_token(payload.token, expected_type="reset")
    except jwt.PyJWTError:
        raise AppError("invalid_token", "Reset link is invalid or has expired", 400)
    if str(data.get("sub", "")).lower() != payload.email.lower():
        raise AppError("invalid_token", "Reset link does not match this account", 400)
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if user is None:
        raise AppError("invalid_token", "Reset link is invalid or has expired", 400)
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    record_audit(db, user, "auth.password_reset", "user", user.id, "Password reset", request)
    return {"status": "password_updated"}


class ProfileOut(BaseModel):
    user: UserOut
    permissions: list[str]


@router.get("/profile", response_model=ProfileOut)
def get_profile(user: CurrentUser) -> ProfileOut:
    return ProfileOut(user=UserOut.model_validate(user), permissions=permissions_for(user))


@router.patch("/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdateIn, request: Request, user: CurrentUser, db: DbDep
) -> User:
    if payload.full_name:
        user.full_name = payload.full_name
    if payload.new_password:
        if not payload.current_password or not verify_password(
            payload.current_password, user.password_hash
        ):
            raise AppError("invalid_password", "Current password is incorrect", 400)
        user.password_hash = hash_password(payload.new_password)
    db.commit()
    record_audit(db, user, "user.profile_update", "user", user.id, "Profile updated", request)
    return user


PERMISSION_MATRIX: dict[UserRole, list[str]] = {
    UserRole.administrator: [
        "pipelines:write", "servers:write", "deployments:write", "deployments:production",
        "alerts:manage", "users:manage", "settings:manage", "integrations:manage",
        "repositories:manage", "audit:read",
    ],
    UserRole.developer: [
        "pipelines:write", "servers:write", "deployments:write", "alerts:manage",
        "repositories:manage",
    ],
    UserRole.viewer: ["alerts:acknowledge"],
}


def permissions_for(user: User) -> list[str]:
    return PERMISSION_MATRIX.get(user.role, [])


def _issue_tokens(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_token(user.email, token_type="access"),
        refresh_token=create_token(user.email, token_type="refresh"),
        user=UserOut.model_validate(user),
    )
