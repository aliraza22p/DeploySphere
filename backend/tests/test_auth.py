"""Authentication, roles and password flows."""

from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import auth


def test_login_success(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@deploysphere.dev", "password": "Admin!2345"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["role"] == "administrator"
    assert body["access_token"]


def test_login_wrong_password(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@deploysphere.dev", "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_me_requires_token(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_me_with_token(client: TestClient, admin_token: str) -> None:
    response = client.get("/api/v1/auth/me", headers=auth(admin_token))
    assert response.status_code == 200
    assert response.json()["email"] == "admin@deploysphere.dev"


def test_register_and_profile(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "newbie@deploysphere.dev",
            "full_name": "New Bee",
            "password": "StrongPass!1",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]

    me = client.get("/api/v1/auth/me", headers=auth(token))
    assert me.status_code == 200
    # self-registered users are not administrators (first account already exists)
    assert me.json()["role"] == "developer"

    # duplicate registration is rejected
    duplicate = client.post(
        "/api/v1/auth/register",
        json={
            "email": "newbie@deploysphere.dev",
            "full_name": "New Bee",
            "password": "StrongPass!1",
        },
    )
    assert duplicate.status_code == 409


def test_password_reset_flow(client: TestClient) -> None:
    forgot = client.post(
        "/api/v1/auth/forgot-password", json={"email": "dev@deploysphere.dev"}
    )
    assert forgot.status_code == 200
    body = forgot.json()
    assert body["demo_mode"] is True
    token = body.get("demo_reset_token")
    assert token, "demo mode must return a reset token"

    reset = client.post(
        "/api/v1/auth/reset-password",
        json={"email": "dev@deploysphere.dev", "token": token, "new_password": "BrandNew!99"},
    )
    assert reset.status_code == 200

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "dev@deploysphere.dev", "password": "BrandNew!99"},
    )
    assert login.status_code == 200

    # restore original demo password so other tests keep working
    forgot2 = client.post(
        "/api/v1/auth/forgot-password", json={"email": "dev@deploysphere.dev"}
    )
    client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": "dev@deploysphere.dev",
            "token": forgot2.json()["demo_reset_token"],
            "new_password": "Dev!12345",
        },
    )


def test_viewer_cannot_create_pipeline(client: TestClient, viewer_token: str) -> None:
    response = client.post(
        "/api/v1/pipelines",
        headers=auth(viewer_token),
        json={
            "name": "nope",
            "repository_id": 1,
            "stages": [{"key": "build", "name": "Build"}],
        },
    )
    assert response.status_code == 403


def test_role_change_requires_admin(
    client: TestClient, viewer_token: str, admin_token: str
) -> None:
    # viewer listing users is forbidden
    assert client.get("/api/v1/users", headers=auth(viewer_token)).status_code == 403
    assert client.get("/api/v1/users", headers=auth(admin_token)).status_code == 200
