from datetime import datetime, timedelta, timezone

from app.simulator import _ensure_utc


def test_ensure_utc_handles_naive_database_datetime() -> None:
    value = datetime(2026, 11, 2, 12, 0)

    assert _ensure_utc(value) == value.replace(tzinfo=timezone.utc)


def test_ensure_utc_converts_aware_datetime() -> None:
    value = datetime(2026, 11, 2, 19, 0, tzinfo=timezone(timedelta(hours=7)))

    assert _ensure_utc(value) == datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
