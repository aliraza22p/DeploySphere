"""Shared query helpers: time ranges and time-series downsampling."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .errors import AppError
from .models import TelemetrySample

RANGES: dict[str, timedelta] = {
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def range_delta(name: str) -> timedelta:
    if name not in RANGES:
        raise AppError("bad_range", f"Unsupported range '{name}'. Use one of: {', '.join(RANGES)}", 400)
    return RANGES[name]


def since(name: str) -> datetime:
    return datetime.now(timezone.utc) - range_delta(name)


def downsample(samples: list[TelemetrySample], max_points: int = 120) -> list[dict]:
    """Average raw samples into at most `max_points` buckets."""
    if not samples:
        return []
    step = max(1, len(samples) // max_points)
    points: list[dict] = []
    for i in range(0, len(samples), step):
        chunk = samples[i : i + step]
        if not chunk:
            continue
        n = len(chunk)
        points.append(
            {
                "ts": chunk[-1].ts.isoformat(),
                "cpu": round(sum(s.cpu_percent for s in chunk) / n, 1),
                "memory": round(sum(s.memory_percent for s in chunk) / n, 1),
                "disk": round(sum(s.disk_percent for s in chunk) / n, 1),
                "network": round(
                    sum(s.network_in_mbps + s.network_out_mbps for s in chunk) / n, 2
                ),
            }
        )
    return points


def uptime_bucket(seconds: int) -> str:
    days, rem = divmod(seconds, 86_400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    return f"{days}d {hours}h {minutes}m"
