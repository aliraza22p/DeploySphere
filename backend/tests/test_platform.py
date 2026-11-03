"""Dashboard, servers, deployments, logs, integrations, audit, health."""

from __future__ import annotations

import pytest
from conftest import auth
from fastapi.testclient import TestClient


def test_health_endpoints(client: TestClient) -> None:
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    ready = client.get("/api/v1/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["database"] == "ok"


def test_dashboard_summary_labels_demo_data(
    client: TestClient, admin_token: str
) -> None:
    response = client.get(
        "/api/v1/dashboard/summary", headers=auth(admin_token), params={"range": "24h"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["data_source"] == "demo"
    assert body["server_counts"]["total"] >= 6
    assert body["pipeline_counts"]["active"] >= 1
    assert body["deployment_counts"]["total"] >= 1
    assert len(body["series"]) > 0
    assert len(body["recent_deployments"]) > 0
    assert len(body["recent_alerts"]) > 0
    assert len(body["services"]) > 0

    bad = client.get(
        "/api/v1/dashboard/summary", headers=auth(admin_token), params={"range": "99d"}
    )
    assert bad.status_code == 422  # pattern-validated query param


def test_servers_list_and_metrics(client: TestClient, admin_token: str) -> None:
    servers = client.get("/api/v1/servers", headers=auth(admin_token)).json()
    assert servers["total"] >= 6
    server_id = servers["items"][0]["id"]

    detail = client.get(f"/api/v1/servers/{server_id}", headers=auth(admin_token))
    assert detail.status_code == 200
    # agent token hash must never be exposed
    assert "agent_token_hash" not in detail.json()

    metrics = client.get(
        f"/api/v1/servers/{server_id}/metrics",
        headers=auth(admin_token),
        params={"range": "24h"},
    )
    assert metrics.status_code == 200
    assert metrics.json()["data_source"] == "demo"
    assert len(metrics.json()["points"]) > 0

    summary = client.get(f"/api/v1/servers/{server_id}/summary", headers=auth(admin_token))
    assert summary.status_code == 200
    assert "uptime" in summary.json()


def test_server_create_rotates_token_and_hides_it(
    client: TestClient, admin_token: str
) -> None:
    created = client.post(
        "/api/v1/servers",
        headers=auth(admin_token),
        json={
            "name": "test-box",
            "hostname": "test-box.local",
            "ip_address": "10.0.0.9",
            "region": "local",
            "environment": "development",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["agent_token"].startswith("dps_")
    assert body["agent_status"] == "offline"

    server_id = body["id"]
    fetched = client.get(f"/api/v1/servers/{server_id}", headers=auth(admin_token)).json()
    assert "agent_token" not in fetched
    assert "agent_token_hash" not in fetched

    rotated = client.post(
        f"/api/v1/servers/{server_id}/rotate-agent-token", headers=auth(admin_token)
    )
    assert rotated.status_code == 200
    assert rotated.json()["agent_token"].startswith("dps_")

    client.delete(f"/api/v1/servers/{server_id}", headers=auth(admin_token))


def test_deployment_production_requires_confirmation(
    client: TestClient, admin_token: str, viewer_token: str
) -> None:
    payload = {
        "name": "storefront-web",
        "version": "9.9.9",
        "commit_sha": "abc123",
        "environment": "production",
        "notes": "test deploy",
    }
    # missing confirmation token
    no_confirm = client.post(
        "/api/v1/deployments", headers=auth(admin_token), json=payload
    )
    assert no_confirm.status_code == 422
    assert no_confirm.json()["error"]["code"] == "confirmation_required"

    # viewers cannot deploy at all
    viewer = client.post(
        "/api/v1/deployments",
        headers=auth(viewer_token),
        json={**payload, "environment": "staging", "confirm": None},
    )
    assert viewer.status_code == 403

    # confirmed production deploy runs (demo simulation) and is labelled demo
    ok = client.post(
        "/api/v1/deployments",
        headers=auth(admin_token),
        json={**payload, "confirm": "production"},
    )
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert body["source"] == "demo"
    assert body["environment"] == "production"
    assert body["status"] in {"pending", "running"}

    # approval gate: pending production deployments can be approved
    if body["status"] == "pending":
        approved = client.post(
            f"/api/v1/deployments/{body['id']}/approve", headers=auth(admin_token)
        )
        assert approved.status_code == 200
        assert approved.json()["status"] == "running"
        assert approved.json()["approved_by"] == "admin@deploysphere.dev"


def test_deployment_rollback(
    client: TestClient, admin_token: str, viewer_token: str
) -> None:
    deployments = client.get(
        "/api/v1/deployments",
        headers=auth(admin_token),
        params={"status": "succeeded", "environment": "production", "q": "storefront-web"},
    ).json()
    assert deployments["total"] >= 1
    target = deployments["items"][0]

    # viewer cannot roll back
    forbidden = client.post(
        f"/api/v1/deployments/{target['id']}/rollback",
        headers=auth(viewer_token),
        json={"confirm": "production", "reason": "test"},
    )
    assert forbidden.status_code == 403

    # production rollback needs confirmation
    no_confirm = client.post(
        f"/api/v1/deployments/{target['id']}/rollback",
        headers=auth(admin_token),
        json={"reason": "bad release"},
    )
    assert no_confirm.status_code == 422

    rolled = client.post(
        f"/api/v1/deployments/{target['id']}/rollback",
        headers=auth(admin_token),
        json={"confirm": "production", "reason": "bad release"},
    )
    assert rolled.status_code == 201, rolled.text
    assert rolled.json()["rollback_of_id"] == target["id"]
    assert rolled.json()["version"] != ""


def test_logs_search_and_export(client: TestClient, admin_token: str) -> None:
    logs = client.get("/api/v1/logs", headers=auth(admin_token), params={"page_size": 10})
    assert logs.status_code == 200
    body = logs.json()
    assert body["total"] >= 400
    assert len(body["items"]) == 10

    filtered = client.get(
        "/api/v1/logs",
        headers=auth(admin_token),
        params={"severity": "error", "page_size": 5},
    )
    assert filtered.status_code == 200
    assert all(item["severity"] == "error" for item in filtered.json()["items"])

    search = client.get("/api/v1/logs", headers=auth(admin_token), params={"q": "health"})
    assert search.status_code == 200
    assert search.json()["total"] >= 1

    # secret redaction: seeded credential-looking lines must be masked
    leaked = client.get("/api/v1/logs", headers=auth(admin_token), params={"q": "super-secret"})
    for item in leaked.json()["items"]:
        assert "super-secret" not in item["message"]
        assert "[REDACTED]" in item["message"]

    export = client.get("/api/v1/logs/export", headers=auth(admin_token))
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")
    assert "attachment" in export.headers["content-disposition"]
    assert "timestamp,severity,source" in export.text


def test_integrations_never_fake_success(
    client: TestClient, admin_token: str
) -> None:
    integrations = client.get(
        "/api/v1/integrations", headers=auth(admin_token)
    ).json()
    assert len(integrations) >= 4
    for item in integrations:
        assert "token" not in str(item.get("config", {})).lower() or item["configured"] is False

    # configuring then testing an unconfigured integration must not claim success
    slack = next(i for i in integrations if i["key"] == "slack")
    assert slack["configured"] is False

    test = client.post(
        "/api/v1/integrations/slack/test", headers=auth(admin_token)
    ).json()
    assert test["ok"] is False
    assert "not configured" in test["message"].lower()


def test_audit_log_records_actions(client: TestClient, admin_token: str) -> None:
    response = client.get(
        "/api/v1/audit",
        headers=auth(admin_token),
        params={"hours": 168, "page": 1, "page_size": 50, "q": "login"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    actions = {item["action"] for item in body["items"]}
    assert "auth.login" in actions
    invalid_range = client.get(
        "/api/v1/audit", headers=auth(admin_token), params={"hours": 721}
    )
    assert invalid_range.status_code == 422


def test_production_seed_requires_private_admin_password(monkeypatch) -> None:
    from app.models import UserRole
    from app.seed import _users_to_seed

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEMO_ADMIN_EMAIL", "owner@example.com")
    monkeypatch.delenv("DEMO_ADMIN_PASSWORD", raising=False)
    with pytest.raises(RuntimeError, match="DEMO_ADMIN_PASSWORD"):
        _users_to_seed()

    password = "long-private-production-password"
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", password)
    assert _users_to_seed() == [
        ("owner@example.com", "DeploySphere Administrator", password, UserRole.administrator)
    ]


def test_production_seed_supports_only_the_admin_user(monkeypatch, tmp_path) -> None:
    from app.database import Base
    from app.models import User
    from app.seed import seed_demo_data
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEMO_ADMIN_EMAIL", "owner@example.com")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "long-private-production-password")

    engine = create_engine(f"sqlite:///{tmp_path / 'production-seed.db'}")
    Base.metadata.create_all(bind=engine)
    try:
        with Session(engine) as db:
            summary = seed_demo_data(db)
            users = db.scalars(select(User)).all()

        assert summary["users"] == 1
        assert [user.email for user in users] == ["owner@example.com"]
    finally:
        engine.dispose()


def test_settings_roundtrip(client: TestClient, admin_token: str, viewer_token: str) -> None:
    current = client.get("/api/v1/settings", headers=auth(admin_token))
    assert current.status_code == 200

    forbidden = client.patch(
        "/api/v1/settings", headers=auth(viewer_token), json={"retention_days": 7}
    )
    assert forbidden.status_code == 403

    updated = client.patch(
        "/api/v1/settings",
        headers=auth(admin_token),
        json={"retention_days": 45, "alert_cooldown_seconds": 600},
    )
    assert updated.status_code == 200
    assert updated.json()["retention_days"] == 45


def test_repository_connect_and_webhook_guard(client: TestClient, admin_token: str) -> None:
    created = client.post(
        "/api/v1/repositories",
        headers=auth(admin_token),
        json={"full_name": "acme/shopfront", "default_branch": "main"},
    )
    assert created.status_code == 201
    body = created.json()
    # honest status: no credentials in tests
    assert body["connection_status"] == "missing_credentials"

    detail = client.get(
        f"/api/v1/repositories/{body['id']}", headers=auth(admin_token)
    ).json()
    assert detail["setup_guidance"], "missing credentials must show setup guidance"
    assert detail["data_source"] == "demo"  # sample branches/commits are labelled

    # webhook endpoint rejects unsigned deliveries while unconfigured
    webhook = client.post(
        "/api/v1/repositories/webhook/github",
        json={"ref": "refs/heads/main", "repository": {"full_name": "acme/shopfront"}},
    )
    assert webhook.status_code == 409

    client.delete(f"/api/v1/repositories/{body['id']}", headers=auth(admin_token))


def test_application_health_check_without_url(
    client: TestClient, admin_token: str
) -> None:
    apps = client.get("/api/v1/applications", headers=auth(admin_token)).json()
    assert apps["total"] >= 5
    app_without_url = next(a for a in apps["items"] if not a["health_url"])
    check = client.post(
        f"/api/v1/applications/{app_without_url['id']}/check", headers=auth(admin_token)
    )
    assert check.status_code == 200
    assert "skipped" in check.json()["message"].lower()
