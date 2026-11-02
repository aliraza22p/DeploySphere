"""Pydantic request/response schemas (validation + typed API contract)."""

from __future__ import annotations

from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list = []
    request_id: str = ""


class ErrorEnvelope(BaseModel):
    error: ErrorBody


# --------------------------------------------------------------------------- #
# Auth / users
# --------------------------------------------------------------------------- #


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RegisterIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    email: EmailStr
    token: str = Field(min_length=8)
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    role: str
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    role: Literal["administrator", "developer", "viewer"] | None = None
    is_active: bool | None = None


class InviteUserIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    role: Literal["administrator", "developer", "viewer"] = "developer"


class ProfileUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #


class MetricPoint(BaseModel):
    ts: datetime
    cpu: float
    memory: float
    disk: float
    network: float


class DashboardSummary(BaseModel):
    data_source: Literal["live", "demo"]
    server_counts: dict[str, int]
    pipeline_counts: dict[str, int]
    deployment_counts: dict[str, int]
    alert_counts: dict[str, int]
    fleet: dict[str, float]
    uptime_seconds: int
    series: list[MetricPoint]
    deployment_trend: list[dict]
    recent_deployments: list["DeploymentOut"]
    recent_alerts: list["AlertOut"]
    recent_runs: list["PipelineRunOut"]
    services: list["ApplicationOut"]
    generated_at: datetime


# --------------------------------------------------------------------------- #
# Repositories & pipelines
# --------------------------------------------------------------------------- #


class RepositoryIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=255, pattern=r"^[\w.\-]+/[\w.\-]+$")
    default_branch: str = Field(default="main", max_length=120)
    clone_url: str = Field(default="", max_length=512)
    connect_webhook: bool = False


class RepositoryOut(ORMModel):
    id: int
    name: str
    full_name: str
    owner: str
    provider: str
    default_branch: str
    clone_url: str
    connection_status: str
    status_detail: str
    webhook_configured: bool
    last_event_at: datetime | None
    created_at: datetime


class StageDefinition(BaseModel):
    key: str = Field(pattern=r"^[a-z_]+$")
    name: str = Field(min_length=1, max_length=120)
    timeout_seconds: int = Field(default=300, ge=10, le=7200)


class PipelineIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    repository_id: int
    branch: str = Field(default="main", max_length=160)
    triggers: list[str] = Field(default_factory=lambda: ["push"])
    stages: list[StageDefinition] = Field(min_length=1)
    enabled: bool = True
    timeout_seconds: int = Field(default=1800, ge=60, le=21600)
    environment: Literal["development", "staging", "production"] = "development"


class PipelineUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    branch: str | None = None
    triggers: list[str] | None = None
    stages: list[StageDefinition] | None = None
    enabled: bool | None = None
    timeout_seconds: int | None = Field(default=None, ge=60, le=21600)
    environment: Literal["development", "staging", "production"] | None = None


class PipelineOut(ORMModel):
    id: int
    name: str
    repository_id: int
    branch: str
    triggers: list
    stages: list
    enabled: bool
    timeout_seconds: int
    environment: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    repository: RepositoryOut | None = None
    last_run: "PipelineRunOut | None" = None


class StageOut(ORMModel):
    id: int
    key: str
    name: str
    position: int
    status: str
    attempt: int
    log: str
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: int | None


class PipelineRunOut(ORMModel):
    id: int
    pipeline_id: int
    number: int
    status: str
    commit_sha: str
    commit_message: str
    branch: str
    triggered_by: str
    trigger_event: str
    artifact_version: str
    source: str
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: int | None
    pipeline: "PipelineBrief | None" = None


class PipelineBrief(BaseModel):
    id: int
    name: str
    environment: str

    model_config = ConfigDict(from_attributes=True)


class PipelineRunDetail(PipelineRunOut):
    stages: list[StageOut] = []


# --------------------------------------------------------------------------- #
# Servers / telemetry
# --------------------------------------------------------------------------- #


class ServerIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    hostname: str = Field(min_length=2, max_length=160)
    ip_address: str = Field(default="", max_length=64)
    region: str = Field(default="local", max_length=80)
    operating_system: str = Field(default="linux", max_length=80)
    environment: Literal["development", "staging", "production"] = "development"
    cpu_threshold: float = Field(default=85.0, ge=1, le=100)
    memory_threshold: float = Field(default=90.0, ge=1, le=100)
    disk_threshold: float = Field(default=90.0, ge=1, le=100)
    collection_interval_seconds: int = Field(default=15, ge=5, le=3600)


class ServerUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    region: str | None = None
    cpu_threshold: float | None = Field(default=None, ge=1, le=100)
    memory_threshold: float | None = Field(default=None, ge=1, le=100)
    disk_threshold: float | None = Field(default=None, ge=1, le=100)
    collection_interval_seconds: int | None = Field(default=None, ge=5, le=3600)


class ServerOut(ORMModel):
    id: int
    name: str
    hostname: str
    ip_address: str
    region: str
    operating_system: str
    environment: str
    status: str
    agent_status: str
    cpu_percent: float
    memory_percent: float
    disk_percent: float
    network_in_mbps: float
    network_out_mbps: float
    uptime_seconds: int
    cpu_threshold: float
    memory_threshold: float
    disk_threshold: float
    collection_interval_seconds: int
    last_seen_at: datetime | None
    created_at: datetime


class ServerCreated(ServerOut):
    agent_token: str = ""
    agent_token_warning: str = ""


class TelemetrySeries(BaseModel):
    data_source: str
    range: str
    points: list[MetricPoint]


# --------------------------------------------------------------------------- #
# Applications
# --------------------------------------------------------------------------- #


class ApplicationIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    server_id: int | None = None
    environment: Literal["development", "staging", "production"] = "development"
    health_url: str = Field(default="", max_length=512)
    version: str = Field(default="1.0.0", max_length=80)


class ApplicationUpdateIn(BaseModel):
    name: str | None = None
    health_url: str | None = None
    version: str | None = None
    environment: Literal["development", "staging", "production"] | None = None
    server_id: int | None = None


class HealthCheckOut(ORMModel):
    id: int
    ok: bool
    http_status: int | None
    response_time_ms: int | None
    message: str
    checked_at: datetime


class ApplicationOut(ORMModel):
    id: int
    name: str
    server_id: int | None
    environment: str
    health_url: str
    status: str
    response_time_ms: int | None
    http_status: int | None
    error_rate_percent: float
    version: str
    last_checked_at: datetime | None
    created_at: datetime
    server: ServerOut | None = None


class ApplicationDetail(ApplicationOut):
    checks: list[HealthCheckOut] = []


# --------------------------------------------------------------------------- #
# Deployments
# --------------------------------------------------------------------------- #


class DeploymentIn(BaseModel):
    application_id: int | None = None
    name: str = Field(min_length=2, max_length=160)
    version: str = Field(min_length=1, max_length=80)
    commit_sha: str = Field(default="", max_length=40)
    environment: Literal["development", "staging", "production"]
    notes: str = Field(default="", max_length=2000)
    confirm: str | None = None  # required "production" token for prod deploys


class RollbackIn(BaseModel):
    confirm: str | None = None
    reason: str = Field(default="", max_length=500)


class DeploymentOut(ORMModel):
    id: int
    application_id: int | None
    name: str
    version: str
    commit_sha: str
    environment: str
    status: str
    initiated_by: str
    approved_by: str
    notes: str
    log: str
    health_check_result: str
    rollback_of_id: int | None
    requires_approval: bool
    source: str
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: int | None
    created_at: datetime


# --------------------------------------------------------------------------- #
# Alerts
# --------------------------------------------------------------------------- #


class AlertOut(ORMModel):
    id: int
    title: str
    description: str
    severity: str
    status: str
    source: str
    server_id: int | None
    application_id: int | None
    deployment_id: int | None
    suggested_action: str
    occurrence_count: int
    acknowledged_by: str
    acknowledged_at: datetime | None
    muted_until: datetime | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    server: ServerOut | None = None
    application: ApplicationOut | None = None


class AlertActionIn(BaseModel):
    action: Literal["acknowledge", "resolve", "mute", "reopen"]
    mute_minutes: int | None = Field(default=None, ge=1, le=10080)


class AlertCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=2000)
    severity: Literal["info", "warning", "critical"] = "warning"
    server_id: int | None = None
    application_id: int | None = None
    suggested_action: str = Field(default="", max_length=255)


# --------------------------------------------------------------------------- #
# Logs
# --------------------------------------------------------------------------- #


class LogOut(ORMModel):
    id: int
    ts: datetime
    source: str
    severity: str
    message: str
    server_id: int | None
    pipeline_run_id: int | None
    deployment_id: int | None
    trace_id: str
    source_data: str


# --------------------------------------------------------------------------- #
# Integrations / settings / audit
# --------------------------------------------------------------------------- #


class IntegrationOut(ORMModel):
    id: int
    key: str
    name: str
    category: str
    description: str
    configured: bool
    config: dict
    last_tested_at: datetime | None
    last_test_result: str
    last_test_ok: bool | None


class IntegrationUpdateIn(BaseModel):
    config: dict = Field(default_factory=dict)
    clear: bool = False


class SettingsOut(ORMModel):
    id: int
    site_name: str
    timezone: str
    retention_days: int
    alert_cooldown_seconds: int
    deduplicate_alerts: bool
    notify_email_enabled: bool
    notify_slack_enabled: bool
    notify_discord_enabled: bool
    production_approval_required: bool
    demo_mode: bool
    updated_at: datetime


class SettingsUpdateIn(BaseModel):
    site_name: str | None = Field(default=None, min_length=1, max_length=120)
    timezone: str | None = None
    retention_days: int | None = Field(default=None, ge=1, le=365)
    alert_cooldown_seconds: int | None = Field(default=None, ge=0, le=86400)
    deduplicate_alerts: bool | None = None
    notify_email_enabled: bool | None = None
    notify_slack_enabled: bool | None = None
    notify_discord_enabled: bool | None = None
    production_approval_required: bool | None = None
    demo_mode: bool | None = None


class AuditOut(ORMModel):
    id: int
    actor_email: str
    action: str
    resource_type: str
    resource_id: str
    detail: str
    ip_address: str
    created_at: datetime
