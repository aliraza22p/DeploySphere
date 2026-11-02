"""Pytest configuration.

Environment variables are set BEFORE the application is imported because
config.py reads them at import time.
"""

from __future__ import annotations

import os
import pathlib
import sys

# --- environment (must precede any app import) ---------------------------- #
TEST_DB = pathlib.Path(__file__).resolve().parent.parent / "pytest.db"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["DEMO_MODE"] = "true"
os.environ["SIMULATOR_ENABLED"] = "false"  # deterministic tests
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    """Application client; entering the context runs the lifespan (db+seed)."""
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def admin_token(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@deploysphere.dev", "password": "Admin!2345"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture(scope="session")
def dev_token(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "dev@deploysphere.dev", "password": "Dev!12345"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture(scope="session")
def viewer_token(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "viewer@deploysphere.dev", "password": "View!12345"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def teardown_module() -> None:
    if TEST_DB.exists():
        TEST_DB.unlink()
