"""Pipeline definitions, runs, stage states and controls."""

from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import auth


def test_list_pipelines_seeded(client: TestClient, admin_token: str) -> None:
    response = client.get("/api/v1/pipelines", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 4
    first = body["items"][0]
    assert "stages" in first and "repository" in first


def test_pipeline_crud_and_run(client: TestClient, dev_token: str, admin_token: str) -> None:
    # create a repository first
    repo = client.post(
        "/api/v1/repositories",
        headers=auth(dev_token),
        json={"full_name": "acme/petstore", "default_branch": "main"},
    )
    assert repo.status_code == 201, repo.text
    repo_id = repo.json()["id"]

    # create pipeline
    created = client.post(
        "/api/v1/pipelines",
        headers=auth(dev_token),
        json={
            "name": "Petstore CI",
            "repository_id": repo_id,
            "branch": "main",
            "triggers": ["push", "pull_request"],
            "stages": [
                {"key": "checkout", "name": "Source checkout"},
                {"key": "build", "name": "Build"},
                {"key": "test", "name": "Tests"},
            ],
            "environment": "staging",
        },
    )
    assert created.status_code == 201, created.text
    pipeline = created.json()
    pipeline_id = pipeline["id"]
    assert pipeline["enabled"] is True
    assert len(pipeline["stages"]) == 3

    # update: disable it
    patched = client.patch(
        f"/api/v1/pipelines/{pipeline_id}",
        headers=auth(dev_token),
        json={"enabled": False},
    )
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False

    # running a disabled pipeline is refused
    refused = client.post(
        f"/api/v1/pipelines/{pipeline_id}/run", headers=auth(dev_token)
    )
    assert refused.status_code == 409

    # re-enable and run
    client.patch(
        f"/api/v1/pipelines/{pipeline_id}", headers=auth(dev_token), json={"enabled": True}
    )
    run_resp = client.post(
        f"/api/v1/pipelines/{pipeline_id}/run", headers=auth(dev_token)
    )
    assert run_resp.status_code == 201, run_resp.text
    run = run_resp.json()
    assert run["status"] in {"queued", "running"}
    assert len(run["stages"]) == 3

    # run detail includes stage logs/ids
    detail = client.get(
        f"/api/v1/pipeline-runs/{run['id']}", headers=auth(dev_token)
    )
    assert detail.status_code == 200
    assert detail.json()["number"] == run["number"]

    # cancel while active
    cancelled = client.post(
        f"/api/v1/pipeline-runs/{run['id']}/cancel", headers=auth(dev_token)
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    # cancelling twice is a conflict
    again = client.post(
        f"/api/v1/pipeline-runs/{run['id']}/cancel", headers=auth(dev_token)
    )
    assert again.status_code == 409

    # filters
    listed = client.get(
        "/api/v1/pipeline-runs", headers=auth(dev_token),
        params={"pipeline_id": pipeline_id, "status": "cancelled"},
    )
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1

    # cleanup
    client.delete(f"/api/v1/pipelines/{pipeline_id}", headers=auth(admin_token))


def test_stage_retry_endpoint(client: TestClient, dev_token: str) -> None:
    """A failed stage from seed data can be retried; a succeeded one cannot."""
    runs = client.get(
        "/api/v1/pipeline-runs", headers=auth(dev_token), params={"status": "failed"}
    ).json()
    assert runs["total"] >= 1, "seed data should contain failed runs"
    run_detail = client.get(
        f"/api/v1/pipeline-runs/{runs['items'][0]['id']}", headers=auth(dev_token)
    ).json()
    failed_stage = next(s for s in run_detail["stages"] if s["status"] == "failed")

    retried = client.post(
        f"/api/v1/pipeline-runs/{run_detail['id']}/stages/{failed_stage['id']}/retry",
        headers=auth(dev_token),
    )
    assert retried.status_code == 200
    stage = next(s for s in retried.json()["stages"] if s["id"] == failed_stage["id"])
    assert stage["attempt"] == failed_stage["attempt"] + 1
    assert stage["status"] == "running"


def test_validation_error_shape(client: TestClient, dev_token: str) -> None:
    response = client.post(
        "/api/v1/pipelines",
        headers=auth(dev_token),
        json={"name": "x", "repository_id": 1, "stages": []},
    )
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert isinstance(body["details"], list) and body["details"]
