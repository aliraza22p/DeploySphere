from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from types import SimpleNamespace

from fastapi.testclient import TestClient

from conftest import auth


def _send_workflow_event(
    client: TestClient,
    secret: str,
    delivery_id: str,
    payload: dict,
    signature_secret: str | None = None,
):
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(
        (signature_secret or secret).encode(), body, hashlib.sha256
    ).hexdigest()
    return client.post(
        "/api/v1/repositories/webhook/github",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-GitHub-Event": "workflow_run",
            "X-GitHub-Delivery": delivery_id,
            "X-Hub-Signature-256": f"sha256={signature}",
        },
    )


def _workflow_payload(repo_name: str, conclusion: str) -> dict:
    return {
        "action": "completed",
        "workflow": {"name": "DeploySphere CI"},
        "workflow_run": {
            "id": 987654,
            "name": "DeploySphere CI",
            "status": "completed",
            "conclusion": conclusion,
            "head_branch": "main",
            "head_sha": "a" * 40,
            "head_commit": {"message": "Add GitHub Actions integration"},
            "run_started_at": "2026-11-03T10:00:00Z",
            "updated_at": "2026-11-03T10:02:30Z",
            "actor": {"login": "deploysphere-ci"},
        },
        "repository": {
            "full_name": f"sample-owner/{repo_name}",
            "name": repo_name,
            "default_branch": "main",
            "clone_url": f"https://github.com/sample-owner/{repo_name}.git",
            "owner": {"login": "sample-owner"},
        },
    }


def test_completed_github_workflow_is_saved_as_live_run(
    client: TestClient, admin_token: str, monkeypatch
) -> None:
    import app.routers.repositories as repositories

    secret = "test-github-webhook-secret"
    monkeypatch.setattr(
        repositories, "settings", SimpleNamespace(github_webhook_secret=secret)
    )
    repo_name = f"live-workflow-{uuid.uuid4().hex[:8]}"
    delivery_id = str(uuid.uuid4())
    payload = _workflow_payload(repo_name, "success")

    response = _send_workflow_event(client, secret, delivery_id, payload)

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "processed"
    assert len(body["pipelines_triggered"]) == 1

    repositories_list = client.get(
        "/api/v1/repositories", headers=auth(admin_token)
    ).json()
    repository = next(item for item in repositories_list if item["name"] == repo_name)
    assert repository["connection_status"] == "connected"
    assert repository["webhook_configured"] is True

    pipelines = client.get(
        "/api/v1/pipelines", headers=auth(admin_token), params={"q": "DeploySphere CI"}
    ).json()
    pipeline = next(
        item for item in pipelines["items"]
        if item["repository_id"] == repository["id"]
    )
    runs = client.get(
        "/api/v1/pipeline-runs",
        headers=auth(admin_token),
        params={"pipeline_id": pipeline["id"]},
    ).json()
    run = next(item for item in runs["items"] if item["source"] == "live")
    assert run["status"] == "succeeded"
    assert run["commit_sha"] == "a" * 40
    assert run["duration_seconds"] == 150

    duplicate = _send_workflow_event(client, secret, delivery_id, payload)
    assert duplicate.status_code == 202
    assert duplicate.json()["status"] == "duplicate"


def test_github_webhook_rejects_invalid_signature(
    client: TestClient, monkeypatch
) -> None:
    import app.routers.repositories as repositories

    monkeypatch.setattr(
        repositories,
        "settings",
        SimpleNamespace(github_webhook_secret="expected-secret"),
    )
    response = _send_workflow_event(
        client,
        "expected-secret",
        str(uuid.uuid4()),
        _workflow_payload(f"bad-signature-{uuid.uuid4().hex[:8]}", "failure"),
        signature_secret="wrong-secret",
    )

    assert response.status_code == 401
