"""SQLAlchemy models for the DeploySphere data model.

All entities required by the specification: users/roles, repositories,
pipeline definitions/runs/stages, servers/agents/telemetry, applications,
deployments, alerts, logs, integrations, audit events and settings.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def enum_value(enum_cls: type[enum.Enum]) -> enum.Enum:
    """Store enum names (readable, stable across databases)."""
    return Enum(
        enum_cls,
        values_callable=lambda e: [member.name for member in e],
        native_enum=False,
        length=32,
    )


class UserRole(str, enum.Enum):
    administrator = "administrator"
    developer = "developer"
    viewer = "viewer"


class DataSource(str, enum.Enum):
    live = "live"
    demo = "demo"


class RunStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class Environment(str, enum.Enum):
    development = "development"
    staging = "staging"
    production = "production"


class DeploymentStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    rolled_back = "rolled_back"
    cancelled = "cancelled"


class ServerStatus(str, enum.Enum):
    healthy = "healthy"
    warning = "warning"
    critical = "critical"
    offline = "offline"


class AgentStatus(str, enum.Enum):
    online = "online"
    stale = "stale"
    offline = "offline"


class AppStatus(str, enum.Enum):
    healthy = "healthy"
    degraded = "degraded"
    down = "down"
    unknown = "unknown"


class AlertSeverity(str, enum.Enum):
    info = "info"
    warning = "warning"
    critical = "critical"
    resolved = "resolved"


class AlertStatus(str, enum.Enum):
    open = "open"
    acknowledged = "acknowledged"
    muted = "muted"
    resolved = "resolved"


class LogSeverity(str, enum.Enum):
    debug = "debug"
    info = "info"
    warning = "warning"
    error = "error"
    critical = "critical"


class LogSource(str, enum.Enum):
    pipeline = "pipeline"
    build = "build"
    deployment = "deployment"
    agent = "agent"
    server = "server"
    application = "application"
    system = "system"


class ConnectionStatus(str, enum.Enum):
    connected = "connected"
    missing_credentials = "missing_credentials"
    error = "error"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(enum_value(UserRole), default=UserRole.developer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    audit_events: Mapped[list["AuditEvent"]] = relationship(back_populates="actor")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_email: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(80), index=True)
    resource_type: Mapped[str] = mapped_column(String(60), index=True)
    resource_id: Mapped[str] = mapped_column(String(60), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    actor: Mapped[User | None] = relationship(back_populates="audit_events")


class Repository(Base):
    __tablename__ = "repositories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    full_name: Mapped[str] = mapped_column(String(255), unique=True)
    owner: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(40), default="github")
    default_branch: Mapped[str] = mapped_column(String(120), default="main")
    clone_url: Mapped[str] = mapped_column(String(512), default="")
    connection_status: Mapped[ConnectionStatus] = mapped_column(
        enum_value(ConnectionStatus), default=ConnectionStatus.missing_credentials
    )
    status_detail: Mapped[str] = mapped_column(String(255), default="")
    webhook_configured: Mapped[bool] = mapped_column(Boolean, default=False)
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    pipelines: Mapped[list["Pipeline"]] = relationship(back_populates="repository")


class Pipeline(Base):
    __tablename__ = "pipelines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"))
    branch: Mapped[str] = mapped_column(String(160), default="main")
    triggers: Mapped[list] = mapped_column(JSON, default=list)
    stages: Mapped[list] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=1800)
    environment: Mapped[Environment] = mapped_column(
        enum_value(Environment), default=Environment.development
    )
    created_by: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    repository: Mapped[Repository] = relationship(back_populates="pipelines")
    runs: Mapped[list["PipelineRun"]] = relationship(
        back_populates="pipeline", cascade="all, delete-orphan"
    )


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"
    __table_args__ = (UniqueConstraint("pipeline_id", "number", name="uq_run_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    status: Mapped[RunStatus] = mapped_column(enum_value(RunStatus), default=RunStatus.queued)
    commit_sha: Mapped[str] = mapped_column(String(40))
    commit_message: Mapped[str] = mapped_column(String(255), default="")
    branch: Mapped[str] = mapped_column(String(160), default="main")
    triggered_by: Mapped[str] = mapped_column(String(255))
    trigger_event: Mapped[str] = mapped_column(String(60), default="manual")
    artifact_version: Mapped[str] = mapped_column(String(80), default="")
    source: Mapped[DataSource] = mapped_column(
        enum_value(DataSource), default=DataSource.demo
    )
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    pipeline: Mapped[Pipeline] = relationship(back_populates="runs")
    stages: Mapped[list["PipelineStage"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="PipelineStage.position",
    )


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id"), index=True)
    key: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[RunStatus] = mapped_column(enum_value(RunStatus), default=RunStatus.queued)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    log: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    run: Mapped[PipelineRun] = relationship(back_populates="stages")


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    hostname: Mapped[str] = mapped_column(String(160))
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    region: Mapped[str] = mapped_column(String(80), default="local")
    operating_system: Mapped[str] = mapped_column(String(80), default="linux")
    environment: Mapped[Environment] = mapped_column(
        enum_value(Environment), default=Environment.development
    )
    status: Mapped[ServerStatus] = mapped_column(
        enum_value(ServerStatus), default=ServerStatus.healthy
    )
    agent_status: Mapped[AgentStatus] = mapped_column(
        enum_value(AgentStatus), default=AgentStatus.offline
    )
    # Agent secret: server-side only, never returned to the browser.
    agent_token_hash: Mapped[str] = mapped_column(String(255), default="")
    cpu_percent: Mapped[float] = mapped_column(Float, default=0.0)
    memory_percent: Mapped[float] = mapped_column(Float, default=0.0)
    disk_percent: Mapped[float] = mapped_column(Float, default=0.0)
    network_in_mbps: Mapped[float] = mapped_column(Float, default=0.0)
    network_out_mbps: Mapped[float] = mapped_column(Float, default=0.0)
    uptime_seconds: Mapped[int] = mapped_column(Integer, default=0)
    cpu_threshold: Mapped[float] = mapped_column(Float, default=85.0)
    memory_threshold: Mapped[float] = mapped_column(Float, default=90.0)
    disk_threshold: Mapped[float] = mapped_column(Float, default=90.0)
    collection_interval_seconds: Mapped[int] = mapped_column(Integer, default=15)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    telemetry: Mapped[list["TelemetrySample"]] = relationship(
        back_populates="server", cascade="all, delete-orphan"
    )


class TelemetrySample(Base):
    __tablename__ = "telemetry_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    server_id: Mapped[int] = mapped_column(ForeignKey("servers.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    cpu_percent: Mapped[float] = mapped_column(Float, default=0.0)
    memory_percent: Mapped[float] = mapped_column(Float, default=0.0)
    disk_percent: Mapped[float] = mapped_column(Float, default=0.0)
    network_in_mbps: Mapped[float] = mapped_column(Float, default=0.0)
    network_out_mbps: Mapped[float] = mapped_column(Float, default=0.0)
    uptime_seconds: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[DataSource] = mapped_column(
        enum_value(DataSource), default=DataSource.demo
    )

    server: Mapped[Server] = relationship(back_populates="telemetry")


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    server_id: Mapped[int | None] = mapped_column(ForeignKey("servers.id"), nullable=True)
    environment: Mapped[Environment] = mapped_column(
        enum_value(Environment), default=Environment.development
    )
    health_url: Mapped[str] = mapped_column(String(512), default="")
    status: Mapped[AppStatus] = mapped_column(enum_value(AppStatus), default=AppStatus.unknown)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_rate_percent: Mapped[float] = mapped_column(Float, default=0.0)
    version: Mapped[str] = mapped_column(String(80), default="1.0.0")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    server: Mapped[Server | None] = relationship()
    checks: Mapped[list["HealthCheck"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )


class HealthCheck(Base):
    __tablename__ = "health_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"), index=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(String(255), default="")
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    application: Mapped[Application] = relationship(back_populates="checks")


class Deployment(Base):
    __tablename__ = "deployments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int | None] = mapped_column(ForeignKey("applications.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(160))
    version: Mapped[str] = mapped_column(String(80))
    commit_sha: Mapped[str] = mapped_column(String(40), default="")
    environment: Mapped[Environment] = mapped_column(
        enum_value(Environment), default=Environment.staging
    )
    status: Mapped[DeploymentStatus] = mapped_column(
        enum_value(DeploymentStatus), default=DeploymentStatus.pending
    )
    initiated_by: Mapped[str] = mapped_column(String(255))
    approved_by: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    log: Mapped[str] = mapped_column(Text, default="")
    health_check_result: Mapped[str] = mapped_column(String(255), default="")
    rollback_of_id: Mapped[int | None] = mapped_column(ForeignKey("deployments.id"), nullable=True)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[DataSource] = mapped_column(
        enum_value(DataSource), default=DataSource.demo
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[AlertSeverity] = mapped_column(
        enum_value(AlertSeverity), default=AlertSeverity.warning
    )
    status: Mapped[AlertStatus] = mapped_column(
        enum_value(AlertStatus), default=AlertStatus.open, index=True
    )
    source: Mapped[str] = mapped_column(String(60), default="monitoring")
    server_id: Mapped[int | None] = mapped_column(ForeignKey("servers.id"), nullable=True)
    application_id: Mapped[int | None] = mapped_column(
        ForeignKey("applications.id"), nullable=True
    )
    deployment_id: Mapped[int | None] = mapped_column(ForeignKey("deployments.id"), nullable=True)
    suggested_action: Mapped[str] = mapped_column(String(255), default="")
    dedup_key: Mapped[str] = mapped_column(String(160), default="", index=True)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    acknowledged_by: Mapped[str] = mapped_column(String(255), default="")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    muted_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    server: Mapped[Server | None] = relationship()
    application: Mapped[Application | None] = relationship()


class LogRecord(Base):
    __tablename__ = "log_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    source: Mapped[LogSource] = mapped_column(enum_value(LogSource), index=True)
    severity: Mapped[LogSeverity] = mapped_column(enum_value(LogSeverity), index=True)
    message: Mapped[str] = mapped_column(Text)
    server_id: Mapped[int | None] = mapped_column(ForeignKey("servers.id"), nullable=True)
    pipeline_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("pipeline_runs.id"), nullable=True
    )
    deployment_id: Mapped[int | None] = mapped_column(ForeignKey("deployments.id"), nullable=True)
    trace_id: Mapped[str] = mapped_column(String(64), default="")
    source_data: Mapped[DataSource] = mapped_column(
        enum_value(DataSource), default=DataSource.demo, index=True
    )


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(60), default="notifications")
    description: Mapped[str] = mapped_column(String(255), default="")
    configured: Mapped[bool] = mapped_column(Boolean, default=False)
    # Non-secret configuration only; credentials stay server-side.
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_test_result: Mapped[str] = mapped_column(String(255), default="")
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    site_name: Mapped[str] = mapped_column(String(120), default="DeploySphere")
    timezone: Mapped[str] = mapped_column(String(60), default="UTC")
    retention_days: Mapped[int] = mapped_column(Integer, default=30)
    alert_cooldown_seconds: Mapped[int] = mapped_column(Integer, default=300)
    deduplicate_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_slack_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_discord_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    production_approval_required: Mapped[bool] = mapped_column(Boolean, default=True)
    demo_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
