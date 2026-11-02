"""FastAPI dependencies: database, current user, role guards, rate limiting, audit."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Annotated, Callable

import jwt
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .database import get_db
from .errors import AppError
from .models import AuditEvent, User, UserRole
from .security import decode_token

DbDep = Annotated[Session, Depends(get_db)]

# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #


def _bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise AppError("unauthorized", "Authentication required", 401)
    return auth.removeprefix("Bearer ").strip()


def get_current_user(request: Request, db: DbDep) -> User:
    token = _bearer_token(request)
    try:
        payload = decode_token(token, expected_type="access")
    except jwt.PyJWTError:
        raise AppError("unauthorized", "Invalid or expired access token", 401)
    user = db.query(User).filter(User.email == payload.get("sub", "")).first()
    if user is None or not user.is_active:
        raise AppError("unauthorized", "Account not found or disabled", 401)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable:
    def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise AppError(
                "forbidden",
                f"Requires one of: {', '.join(r.value for r in roles)}",
                403,
            )
        return user

    return dependency


AdminUser = Annotated[User, Depends(require_roles(UserRole.administrator))]
EditorUser = Annotated[
    User, Depends(require_roles(UserRole.administrator, UserRole.developer))
]


# --------------------------------------------------------------------------- #
# Login rate limiting (in-memory, per instance)
# --------------------------------------------------------------------------- #

_rate_lock = threading.Lock()
_rate_hits: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(bucket: str, limit: int, window_seconds: int) -> None:
    now = time.monotonic()
    with _rate_lock:
        hits = _rate_hits[bucket]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            raise AppError(
                "rate_limited",
                "Too many attempts, please try again later",
                429,
            )
        hits.append(now)


# --------------------------------------------------------------------------- #
# Audit trail (spec §11)
# --------------------------------------------------------------------------- #


def record_audit(
    db: Session,
    actor: User | None,
    action: str,
    resource_type: str,
    resource_id: str | int = "",
    detail: str = "",
    request: Request | None = None,
) -> AuditEvent:
    ip_address = ""
    if request is not None and request.client is not None:
        ip_address = request.client.host
    event = AuditEvent(
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else "system",
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        detail=detail,
        ip_address=ip_address,
    )
    db.add(event)
    db.commit()
    return event
