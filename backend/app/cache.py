"""Optional Redis cache with an in-memory fallback.

Redis is used for caching and transient real-time state when REDIS_URL is
configured; without it the app falls back to a per-process dict so local
development needs no extra services.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

from .config import settings

_client = None
_lock = threading.Lock()
_memory: dict[str, tuple[float, Any]] = {}


def _redis():
    global _client
    if not settings.redis_url:
        return None
    if _client is None:
        with _lock:
            if _client is None:
                try:
                    import redis  # type: ignore

                    _client = redis.Redis.from_url(
                        settings.redis_url, decode_responses=True, socket_connect_timeout=1
                    )
                    _client.ping()
                except Exception:
                    _client = False  # redis unavailable -> memory fallback
    return _client or None


def cache_get(key: str) -> Any | None:
    client = _redis()
    if client is not None:
        try:
            raw = client.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            return None
    with _lock:
        entry = _memory.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at < time.time():
            _memory.pop(key, None)
            return None
        return value


def cache_set(key: str, value: Any, ttl_seconds: int = 30) -> None:
    client = _redis()
    if client is not None:
        try:
            client.setex(key, ttl_seconds, json.dumps(value, default=str))
            return
        except Exception:
            pass
    with _lock:
        _memory[key] = (time.time() + ttl_seconds, value)


def cache_clear(prefix: str = "") -> None:
    client = _redis()
    if client is not None:
        try:
            keys = client.keys(f"{prefix}*")
            if keys:
                client.delete(*keys)
            return
        except Exception:
            pass
    with _lock:
        if prefix:
            for key in [k for k in _memory if k.startswith(prefix)]:
                _memory.pop(key, None)
        else:
            _memory.clear()
