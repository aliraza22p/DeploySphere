"""Alert lifecycle: creation, acknowledgement, resolution, permissions, stats."""

from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import auth


def test_alert_stats_seeded(client: TestClient, admin_token: str) -> None:
    response = client.get("/api/v1/alerts/stats", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert {"open", "acknowledged", "muted", "resolved", "critical"} <= set(body)


def test_alert_acknowledge_and_resolve(
    client: TestClient, viewer_token: str, admin_token: str
) -> None:
    created = client.post(
        "/api/v1/alerts",
        headers=auth(admin_token),
        json={
            "title": "Synthetic test alert",
            "description": "created by pytest",
            "severity": "warning",
            "suggested_action": "none",
        },
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]
    assert created.json()["status"] == "open"

    # viewers may acknowledge
    acked = client.patch(
        f"/api/v1/alerts/{alert_id}",
        headers=auth(viewer_token),
        json={"action": "acknowledge"},
    )
    assert acked.status_code == 200
    assert acked.json()["status"] == "acknowledged"
    assert acked.json()["acknowledged_by"] == "viewer@deploysphere.dev"

    # ...but not resolve (server-side authorization, not just UI)
    forbidden = client.patch(
        f"/api/v1/alerts/{alert_id}",
        headers=auth(viewer_token),
        json={"action": "resolve"},
    )
    assert forbidden.status_code == 403

    # developers can resolve
    resolved = client.patch(
        f"/api/v1/alerts/{alert_id}",
        headers=auth(admin_token),
        json={"action": "resolve"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"
    assert resolved.json()["resolved_at"] is not None

    # double-resolve is a conflict
    again = client.patch(
        f"/api/v1/alerts/{alert_id}",
        headers=auth(admin_token),
        json={"action": "resolve"},
    )
    assert again.status_code == 409


def test_alert_filters_and_mute(client: TestClient, admin_token: str) -> None:
    critical = client.get(
        "/api/v1/alerts",
        headers=auth(admin_token),
        params={"severity": "critical"},
    )
    assert critical.status_code == 200
    assert all(item["severity"] == "critical" for item in critical.json()["items"])

    muted = client.get(
        "/api/v1/alerts", headers=auth(admin_token), params={"status": "muted"}
    )
    assert muted.status_code == 200
    items = muted.json()["items"]
    if items:
        alert_id = items[0]["id"]
        result = client.patch(
            f"/api/v1/alerts/{alert_id}",
            headers=auth(admin_token),
            json={"action": "mute", "mute_minutes": 30},
        )
        assert result.status_code == 200
        assert result.json()["muted_until"] is not None


def test_bad_filter_rejected(client: TestClient, admin_token: str) -> None:
    response = client.get(
        "/api/v1/alerts", headers=auth(admin_token), params={"severity": "purple"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_severity"
