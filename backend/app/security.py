"""Password hashing, JWT issue/verification, token helpers and secret redaction."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #

_BCRYPT_ROUNDS = 12


def hash_password(password: str) -> str:
    """Hash a password with bcrypt (never store plaintext)."""
    data = password.encode("utf-8")[:72]  # bcrypt truncates at 72 bytes
    return bcrypt.hashpw(data, bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #


def create_token(
    subject: str,
    *,
    token_type: str = "access",
    expires_minutes: int | None = None,
    extra: dict | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    if expires_minutes is None:
        expires_minutes = (
            settings.access_token_expire_minutes
            if token_type == "access"
            else settings.refresh_token_expire_days * 24 * 60
        )
    payload: dict = {
        "sub": subject,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
        "jti": secrets.token_hex(8),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, *, expected_type: str = "access") -> dict:
    """Decode and validate a JWT. Raises jwt.PyJWTError on any failure."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    return payload


# --------------------------------------------------------------------------- #
# Agent / webhook tokens
# --------------------------------------------------------------------------- #


def generate_secret(prefix: str = "") -> str:
    body = secrets.token_urlsafe(32)
    return f"{prefix}{body}" if prefix else body


def hash_secret(value: str) -> str:
    """SHA-256 for high-entropy tokens (agent tokens, webhook secrets)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def verify_secret(value: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False
    return hmac.compare_digest(hash_secret(value), stored_hash)


# --------------------------------------------------------------------------- #
# Log redaction (spec §10: redact secrets before storage or display)
# --------------------------------------------------------------------------- #

_KEY_VALUE_PATTERN = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b(\s*[:=]\s*)(\S+)"
)
_SECRET_PATTERNS = [
    _KEY_VALUE_PATTERN,
    re.compile(r"(?i)(bearer\s+)[a-z0-9._\-]+"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b"),
    re.compile(
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"
    ),
]


def redact_secrets(text: str) -> str:
    """Replace credential-looking values with [REDACTED] before storage/display."""
    if not text:
        return text
    out = _KEY_VALUE_PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]", text)
    for pattern in _SECRET_PATTERNS[1:]:
        out = pattern.sub("[REDACTED]", out)
    return out
