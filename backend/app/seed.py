"""Demo-mode seed data: clearly-labelled sample servers, pipelines, deployments,
logs, alerts, repositories, applications and integrations.

Every generated record is marked with source = "demo" (source_data for logs)
so simulated data can never be confused with live telemetry.
"""

from __future__ import annotations

import math
import os
import random
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    AgentStatus,
    Alert,
    AlertSeverity,
    AlertStatus,
    AppSettings,
    AppStatus,
    Application,
    AuditEvent,
    DataSource,
    Deployment,
    DeploymentStatus,
    Environment,
    HealthCheck,
    Integration,
    LogRecord,
    LogSeverity,
    LogSource,
    Pipeline,
    PipelineRun,
    PipelineStage,
    Repository,
    RunStatus,
    Server,
    ServerStatus,
    TelemetrySample,
    User,
    UserRole,
)
from .security import hash_password, redact_secrets

DEMO_USERS = [
    ("admin@deploysphere.dev", "Amara Osei", "Admin!2345", UserRole.administrator),
    ("dev@deploysphere.dev", "Dev Patel", "Dev!12345", UserRole.developer),
    ("viewer@deploysphere.dev", "Vera Lang", "View!12345", UserRole.viewer),
]

DEFAULT_STAGES = [
    {"key": "checkout", "name": "Source checkout", "timeout_seconds": 120},
    {"key": "dependencies", "name": "Install dependencies", "timeout_seconds": 300},
    {"key": "build", "name": "Build", "timeout_seconds": 600},
    {"key": "test", "name": "Automated tests", "timeout_seconds": 900},
    {"key": "quality", "name": "Code quality checks", "timeout_seconds": 300},
    {"key": "package", "name": "Package artifacts", "timeout_seconds": 300},
    {"key": "deploy", "name": "Deploy", "timeout_seconds": 600},
    {"key": "health", "name": "Post-deploy health check", "timeout_seconds": 120},
]


def _users_to_seed() -> list[tuple[str, str, str, UserRole]]:
    if os.getenv("ENVIRONMENT", "development").lower() != "production":
        return DEMO_USERS

    admin_password = os.getenv("DEMO_ADMIN_PASSWORD", "")
    if len(admin_password) < 16:
        raise RuntimeError(
            "DEMO_ADMIN_PASSWORD must be set to at least 16 characters in production."
        )
    admin_email = os.getenv("DEMO_ADMIN_EMAIL", "admin@deploysphere.dev").lower()
    return [
        (admin_email, "DeploySphere Administrator", admin_password, UserRole.administrator)
    ]


SERVER_DEFS = [
    ("web-prod-01", "web-prod-01.acme.internal", "10.20.1.11", "eu-west-1", "production", 62),
    ("web-prod-02", "web-prod-02.acme.internal", "10.20.1.12", "eu-west-1", "production", 47),
    ("api-prod-01", "api-prod-01.acme.internal", "10.20.2.21", "eu-west-1", "production", 71),
    ("api-stg-01", "api-stg-01.acme.internal", "10.20.5.31", "eu-central-1", "staging", 38),
    ("worker-dev-01", "worker-dev-01.acme.internal", "10.20.8.41", "local", "development", 24),
    ("ci-runner-01", "ci-runner-01.acme.internal", "10.20.9.51", "eu-west-1", "staging", 55),
]

APP_DEFS = [
    ("storefront-web", "production", "https://example.com/healthz", "2.14.3"),
    ("api-gateway", "production", "https://example.com/api/health", "2.14.3"),
    ("auth-service", "production", "https://example.com/auth/health", "1.9.0"),
    ("billing-worker", "staging", "", "0.12.4"),
    ("search-indexer", "development", "", "0.4.1"),
]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _ts(minutes_ago: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)


def _metric_history(server_id: int, base_cpu: float, start: datetime, end: datetime,
                    step_minutes: int, rng: random.Random) -> list[TelemetrySample]:
    """Correlated, plausible metric walk with a daily traffic pattern."""
    samples: list[TelemetrySample] = []
    cpu, mem = base_cpu, min(95.0, base_cpu + rng.uniform(-8, 14))
    disk = 30 + (server_id % 5) * 9 + rng.uniform(-2, 2)
    ts = start
    while ts <= end:
        hour = ts.hour + ts.minute / 60
        diurnal = 12 * max(0.0, -math.cos((hour - 2) / 24 * 2 * math.pi))
        cpu = max(3.0, min(99.0, cpu + rng.uniform(-7, 7) + (diurnal - 6) * 0.15))
        mem = max(10.0, min(98.0, mem + rng.uniform(-4, 4)))
        disk = min(97.0, max(5.0, disk + rng.uniform(-0.2, 0.35)))
        net_in = max(0.1, rng.gauss(40, 22) * (0.6 + cpu / 100))
        net_out = max(0.1, rng.gauss(25, 14) * (0.6 + cpu / 100))
        samples.append(
            TelemetrySample(
                server_id=server_id,
                ts=ts,
                cpu_percent=round(cpu, 1),
                memory_percent=round(mem, 1),
                disk_percent=round(disk, 1),
                network_in_mbps=round(net_in, 2),
                network_out_mbps=round(net_out, 2),
                uptime_seconds=int((ts - start).total_seconds()) + 86_400 * 12,
                source=DataSource.demo,
            )
        )
        ts += timedelta(minutes=step_minutes)
    return samples


def _stage_log(stage_key: str, run_number: int, ok: bool = True) -> str:
    lines = [
        f"[stage:{stage_key}] starting (run #{run_number})",
        f"[stage:{stage_key}] fetching configuration ... ok",
    ]
    detail = {
        "checkout": ["Cloning repository acme/webapp @ main", "Resolved commit a1b2c3d"],
        "dependencies": ["Installing dependencies from lockfile", "Added 214 packages"],
        "build": ["Compiling assets", "Build finished in 42s"],
        "test": ["Running test suites", "184 passed, 0 failed"],
        "quality": ["ruff: 0 issues", "mypy: 0 errors"],
        "package": ["Creating artifact store-2.14.3.tar.gz", "Pushing to artifact registry"],
        "deploy": ["Uploading artifact to target environment", "Rolling update 2/2 ready"],
        "health": ["GET /healthz -> 200 in 84ms", "Health verification passed"],
    }.get(stage_key, ["step executed"])
    lines.extend(f"[stage:{stage_key}] {item}" for item in detail)
    if not ok:
        lines.append(f"[stage:{stage_key}] ERROR: command exited with code 1")
    else:
        lines.append(f"[stage:{stage_key}] completed successfully")
    return "\n".join(lines)


def _deployment_log(name: str, version: str, ok: bool = True) -> str:
    lines = [
        f"deploy: starting rollout of {name} {version}",
        "deploy: pulling artifact from registry",
        "deploy: provisioning containers",
        "deploy: draining connections on old revision",
        "deploy: shifting traffic (10% -> 50% -> 100%)",
    ]
    if ok:
        lines.append("deploy: health check passed (200 OK, 91ms)")
        lines.append("deploy: rollout complete")
    else:
        lines.append("deploy: ERROR health check failed (503 Service Unavailable)")
        lines.append("deploy: rollout halted, previous revision retained")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Seed entry point
# --------------------------------------------------------------------------- #


def needs_seed(db: Session) -> bool:
    return db.scalar(select(User.id).limit(1)) is None


def seed_demo_data(db: Session) -> dict:
    """Populate a fresh database with labelled demo data. Returns a summary."""
    rng = random.Random(20260101)
    now = datetime.now(timezone.utc)

    # -- users -------------------------------------------------------------- #
    users: list[User] = []
    for email, name, password, role in _users_to_seed():
        user = User(
            email=email,
            full_name=name,
            password_hash=hash_password(password),
            role=role,
            is_active=True,
            last_login_at=_ts(rng.uniform(10, 900)),
        )
        db.add(user)
        users.append(user)
    db.flush()

    # -- repositories ------------------------------------------------------- #
    repo_defs = [
        ("webapp", "acme/webapp", "main"),
        ("api-gateway", "acme/api-gateway", "main"),
        ("infra-modules", "acme/infra-modules", "trunk"),
    ]
    repos: list[Repository] = []
    for name, full_name, branch in repo_defs:
        owner, _, repo_name = full_name.partition("/")
        repo = Repository(
            name=name,
            full_name=full_name,
            owner=owner,
            default_branch=branch,
            clone_url=f"https://github.com/{full_name}.git",
            # No real credentials in demo mode: never fake a live connection.
            connection_status="missing_credentials",
            status_detail=(
                "No GitHub credentials configured. Setup: create a fine-grained PAT or "
                "OAuth app, set GITHUB_TOKEN, then reconnect. Demo mode uses simulated "
                "repository events."
            ),
            webhook_configured=False,
            last_event_at=_ts(rng.uniform(30, 600)),
        )
        db.add(repo)
        repos.append(repo)
    db.flush()

    # -- pipelines ---------------------------------------------------------- #
    pipeline_defs = [
        ("Storefront CI/CD", 0, "main", Environment.production, ["push", "pull_request", "tag"]),
        ("API Gateway CI", 0, "main", Environment.staging, ["push", "pull_request"]),
        ("Gateway release", 1, "main", Environment.production, ["tag", "manual"]),
        ("Infra plan & apply", 2, "trunk", Environment.staging, ["pull_request", "manual"]),
    ]
    pipelines: list[Pipeline] = []
    for name, repo_idx, branch, env, triggers in pipeline_defs:
        stages = [dict(s) for s in DEFAULT_STAGES]
        if env == Environment.staging:
            stages = stages[:-1]  # staging pipelines skip the prod health gate
        pipeline = Pipeline(
            name=name,
            repository_id=repos[repo_idx].id,
            branch=branch,
            triggers=triggers,
            stages=stages,
            enabled=True,
            environment=env,
            created_by=users[1].email,
            timeout_seconds=1800,
        )
        db.add(pipeline)
        pipelines.append(pipeline)
    db.flush()

    # -- pipeline runs ------------------------------------------------------ #
    commit_messages = [
        "feat: add checkout summary panel",
        "fix: prevent duplicate webhook processing",
        "chore: bump base image to 2026.10",
        "perf: cache repository branch list",
        "refactor: extract deployment approval gate",
        "fix: correct disk threshold unit conversion",
    ]
    runs: list[PipelineRun] = []
    run_seq = 0
    for pipeline in pipelines:
        for i in range(4):
            run_seq += 1
            status_choice = rng.random()
            if i == 0 and pipeline.enabled:
                status = RunStatus.running
            elif status_choice < 0.62:
                status = RunStatus.succeeded
            elif status_choice < 0.82:
                status = RunStatus.failed
            elif status_choice < 0.92:
                status = RunStatus.cancelled
            else:
                status = RunStatus.queued
            started = _ts(rng.uniform(20, 60 * 24 * 9))
            duration = rng.randint(45, 900) if status != RunStatus.queued else None
            run = PipelineRun(
                pipeline_id=pipeline.id,
                number=1200 + run_seq,
                status=status,
                commit_sha=secrets.token_hex(4)[:8] + secrets.token_hex(16)[:32],
                commit_message=rng.choice(commit_messages),
                branch=pipeline.branch,
                triggered_by=rng.choice([users[1].email, users[0].email, "github-actions"]),
                trigger_event=rng.choice(list(pipeline.triggers)),
                artifact_version=f"2.{rng.randint(1, 20)}.{rng.randint(0, 9)}",
                source=DataSource.demo,
                queued_at=started,
                started_at=started if status != RunStatus.queued else None,
                finished_at=(
                    started + timedelta(seconds=duration)
                    if duration and status in {RunStatus.succeeded, RunStatus.failed, RunStatus.cancelled}
                    else None
                ),
                duration_seconds=duration,
            )
            db.add(run)
            db.flush()
            runs.append(run)

            stage_defs = pipeline.stages
            failed_index = rng.randrange(len(stage_defs)) if status == RunStatus.failed else None
            running_index = 0 if status == RunStatus.running else None
            for idx, stage_def in enumerate(stage_defs):
                if status == RunStatus.queued:
                    stage_status = RunStatus.queued
                elif running_index is not None:
                    stage_status = (
                        RunStatus.running if idx == running_index
                        else RunStatus.queued if idx > running_index
                        else RunStatus.succeeded
                    )
                elif failed_index is not None:
                    if idx < failed_index:
                        stage_status = RunStatus.succeeded
                    elif idx == failed_index:
                        stage_status = RunStatus.failed
                    else:
                        stage_status = RunStatus.queued
                else:
                    stage_status = status if status == RunStatus.cancelled and idx > 3 else RunStatus.succeeded
                stage_started = started + timedelta(seconds=idx * 60) if stage_status != RunStatus.queued else None
                stage_seconds = rng.randint(8, 240) if stage_status in {RunStatus.succeeded, RunStatus.failed, RunStatus.cancelled} else None
                db.add(
                    PipelineStage(
                        run_id=run.id,
                        key=stage_def["key"],
                        name=stage_def["name"],
                        position=idx,
                        status=stage_status,
                        attempt=1,
                        log=_stage_log(stage_def["key"], run.number, ok=stage_status != RunStatus.failed)
                        if stage_status != RunStatus.queued
                        else "",
                        started_at=stage_started,
                        finished_at=(
                            stage_started + timedelta(seconds=stage_seconds)
                            if stage_started and stage_seconds
                            else None
                        ),
                        duration_seconds=stage_seconds,
                    )
                )

    # -- servers ------------------------------------------------------------ #
    servers: list[Server] = []
    for idx, (name, host, ip, region, env, base_cpu) in enumerate(SERVER_DEFS):
        status = (
            ServerStatus.offline if idx == 5
            else ServerStatus.warning if idx == 2
            else ServerStatus.healthy
        )
        server = Server(
            name=name,
            hostname=host,
            ip_address=ip,
            region=region,
            operating_system="ubuntu 24.04" if idx % 2 == 0 else "debian 12",
            environment=Environment[env],
            status=status,
            agent_status=AgentStatus.offline if idx == 5 else AgentStatus.online,
            cpu_percent=float(base_cpu),
            memory_percent=float(min(95, base_cpu + rng.uniform(-6, 12))),
            disk_percent=float(35 + idx * 7),
            network_in_mbps=round(rng.uniform(5, 90), 1),
            network_out_mbps=round(rng.uniform(3, 55), 1),
            uptime_seconds=rng.randint(60_000, 4_000_000),
            last_seen_at=None if idx == 5 else _ts(rng.uniform(0.1, 4)),
        )
        db.add(server)
        servers.append(server)
    db.flush()

    # telemetry history: 1-min resolution for the last 24h, 30-min for the rest
    for idx, server in enumerate(servers):
        server_rng = random.Random(1000 + idx)
        recent_start = now - timedelta(hours=24)
        db.add_all(_metric_history(server.id, SERVER_DEFS[idx][5], recent_start, now, 1, server_rng))
        older_end = recent_start - timedelta(minutes=1)
        older_start = now - timedelta(days=30)
        db.add_all(
            _metric_history(server.id, SERVER_DEFS[idx][5], older_start, older_end, 30, server_rng)
        )
    db.flush()

    # -- applications ------------------------------------------------------- #
    applications: list[Application] = []
    for idx, (name, env, url, version) in enumerate(APP_DEFS):
        status = (
            AppStatus.healthy
            if idx < 2
            else AppStatus.degraded if idx == 2 else AppStatus.unknown
        )
        app = Application(
            name=name,
            server_id=servers[idx % len(servers)].id,
            environment=Environment[env],
            health_url=url,
            status=status,
            response_time_ms=rng.randint(45, 480) if url else None,
            http_status=200 if status == AppStatus.healthy else 503 if status == AppStatus.degraded else None,
            error_rate_percent=round(rng.uniform(0, 2.4), 2),
            version=version,
            last_checked_at=_ts(rng.uniform(0.5, 20)),
        )
        db.add(app)
        applications.append(app)
    db.flush()

    for app in applications:
        for i in range(12):
            ok = app.status != AppStatus.degraded or i % 4 != 0
            db.add(
                HealthCheck(
                    application_id=app.id,
                    ok=ok,
                    http_status=200 if ok else 503,
                    response_time_ms=rng.randint(40, 520),
                    message="OK" if ok else "Service Unavailable",
                    checked_at=_ts(i * 17 + rng.uniform(0, 6)),
                )
            )
    db.flush()

    # -- deployments -------------------------------------------------------- #
    deployments: list[Deployment] = []
    deploy_defs = [
        ("storefront-web", Environment.production, "2.14.3", DeploymentStatus.succeeded),
        ("storefront-web", Environment.production, "2.14.2", DeploymentStatus.succeeded),
        ("api-gateway", Environment.production, "2.14.3", DeploymentStatus.succeeded),
        ("api-gateway", Environment.staging, "2.15.0-rc.1", DeploymentStatus.running),
        ("auth-service", Environment.production, "1.9.0", DeploymentStatus.failed),
        ("billing-worker", Environment.staging, "0.12.4", DeploymentStatus.succeeded),
        ("search-indexer", Environment.development, "0.4.1", DeploymentStatus.succeeded),
        ("storefront-web", Environment.staging, "2.15.0-rc.2", DeploymentStatus.succeeded),
        ("api-gateway", Environment.staging, "2.15.0-rc.1", DeploymentStatus.rolled_back),
        ("auth-service", Environment.staging, "1.9.1-rc.1", DeploymentStatus.pending),
        ("storefront-web", Environment.production, "2.13.9", DeploymentStatus.succeeded),
        ("billing-worker", Environment.production, "0.12.3", DeploymentStatus.succeeded),
    ]
    for i, (name, env, version, status) in enumerate(deploy_defs):
        app = next((a for a in applications if a.name == name), applications[0])
        started = _ts(rng.uniform(30, 60 * 24 * 10))
        duration = rng.randint(35, 480)
        ok = status in {DeploymentStatus.succeeded, DeploymentStatus.rolled_back}
        deployments.append(
            Deployment(
                application_id=app.id,
                name=name,
                version=version,
                commit_sha=secrets.token_hex(20),
                environment=env,
                status=status,
                initiated_by=rng.choice([users[0].email, users[1].email, "github-actions"]),
                approved_by=users[0].email if env == Environment.production and ok else "",
                notes="Demo deployment generated by seed data." if i % 3 == 0 else "",
                log=_deployment_log(name, version, ok=ok)
                + (
                    "\ndeploy: rollback executed, restoring previous revision"
                    if status == DeploymentStatus.rolled_back
                    else ""
                ),
                health_check_result=(
                    "passed (200 OK)" if ok else "failed (503)" if status == DeploymentStatus.failed else ""
                ),
                requires_approval=env == Environment.production,
                source=DataSource.demo,
                started_at=started if status != DeploymentStatus.pending else None,
                finished_at=(
                    started + timedelta(seconds=duration)
                    if status in {DeploymentStatus.succeeded, DeploymentStatus.failed, DeploymentStatus.rolled_back}
                    else None
                ),
                duration_seconds=duration if status != DeploymentStatus.pending else None,
                created_at=started,
            )
        )
    db.add_all(deployments)
    db.flush()

    # -- alerts ------------------------------------------------------------- #
    alert_defs = [
        ("High CPU on api-prod-01", AlertSeverity.critical, AlertStatus.open, 0,
         "CPU sustained above 90% for 10 minutes.",
         "Inspect top processes, scale horizontally or check for traffic spike."),
        ("Disk usage warning on web-prod-02", AlertSeverity.warning, AlertStatus.acknowledged, 1,
         "Disk usage above 85% on /var.", "Rotate logs or expand volume."),
        ("Deployment failed: auth-service 1.9.0", AlertSeverity.critical, AlertStatus.open, None,
         "Health verification failed after rollout.", "Roll back to the previous version."),
        ("Agent offline: ci-runner-01", AlertSeverity.warning, AlertStatus.open, 5,
         "Telemetry agent has not reported for 15 minutes.",
         "Check agent process and network connectivity."),
        ("Elevated response time on storefront-web", AlertSeverity.warning, AlertStatus.muted, None,
         "p95 latency above 800ms for 5 minutes.", "Review slow queries and cache hit rate."),
        ("Replica rebalanced", AlertSeverity.info, AlertStatus.resolved, None,
         "Shard rebalance completed.", "No action required."),
        ("Memory pressure on api-stg-01", AlertSeverity.warning, AlertStatus.resolved, 3,
         "Memory above 90% for 5 minutes.", "Restart worker pool or raise limit."),
        ("Webhook signature mismatch", AlertSeverity.critical, AlertStatus.resolved, None,
         "Rejected GitHub delivery with invalid signature.",
         "Rotate GITHUB_WEBHOOK_SECRET and resend delivery."),
    ]
    for i, (title, severity, status, server_idx, description, action) in enumerate(alert_defs):
        created = _ts(rng.uniform(15, 60 * 24 * 6))
        server = servers[server_idx] if server_idx is not None else None
        db.add(
            Alert(
                title=title,
                description=description,
                severity=severity,
                status=status,
                source="monitoring" if server else "deployment",
                server_id=server.id if server else None,
                application_id=applications[i % len(applications)].id if server is None else None,
                suggested_action=action,
                dedup_key=f"{title.lower().replace(' ', '-')}",
                occurrence_count=rng.randint(1, 7),
                acknowledged_by=users[0].email if status in {AlertStatus.acknowledged, AlertStatus.resolved} else "",
                acknowledged_at=created + timedelta(minutes=4) if status != AlertStatus.open else None,
                resolved_at=created + timedelta(minutes=40) if status == AlertStatus.resolved else None,
                muted_until=now + timedelta(hours=2) if status == AlertStatus.muted else None,
                created_at=created,
            )
        )
    db.flush()

    # -- logs (with secret redaction applied on write) ---------------------- #
    log_templates = [
        (LogSource.application, LogSeverity.info, "request completed status=200 path=/api/v1/catalog duration_ms={ms}"),
        (LogSource.application, LogSeverity.warning, "slow query detected duration_ms={ms} table=orders"),
        (LogSource.application, LogSeverity.error, "upstream timeout after 3000ms service=payment-gateway"),
        (LogSource.pipeline, LogSeverity.info, "step {step} finished successfully in {ms}ms"),
        (LogSource.pipeline, LogSeverity.warning, "dependency cache miss, installing 214 packages"),
        (LogSource.build, LogSeverity.info, "bundled 148 modules (2.4 MB)"),
        (LogSource.build, LogSeverity.error, "ERROR build failed: unresolved import './legacy/config'"),
        (LogSource.deployment, LogSeverity.info, "rolling update progressing 1/2 ready"),
        (LogSource.deployment, LogSeverity.critical, "rollout halted: health check returned 503"),
        (LogSource.server, LogSeverity.info, "agent heartbeat ok cpu={cpu}% mem={mem}%"),
        (LogSource.server, LogSeverity.warning, "load average above threshold: 4.81"),
        (LogSource.agent, LogSeverity.debug, "collected 6 metric series in 42ms"),
        (LogSource.system, LogSeverity.info, "backup completed: 14 tables, 212 MB"),
        (LogSource.system, LogSeverity.warning, "redis cache eviction rate elevated (23/s)"),
    ]
    for i in range(420):
        source, severity, template = rng.choice(log_templates)
        message = template.format(
            ms=rng.randint(12, 3400), step=rng.choice(["test", "build", "package"]),
            cpu=rng.randint(8, 96), mem=rng.randint(20, 94),
        )
        if i % 97 == 0:
            # demonstrates redaction: credentials never reach storage or the UI
            message += " | auth token=super-secret-value-123 redacted on write"
        server = rng.choice(servers) if source in {LogSource.server, LogSource.agent} else None
        run = rng.choice(runs) if source in {LogSource.pipeline, LogSource.build} else None
        deployment = (
            rng.choice(deployments) if source == LogSource.deployment else None
        )
        db.add(
            LogRecord(
                ts=_ts(rng.uniform(1, 60 * 24 * 7)),
                source=source,
                severity=severity,
                message=redact_secrets(message),
                server_id=server.id if server else None,
                pipeline_run_id=run.id if run else None,
                deployment_id=deployment.id if deployment else None,
                trace_id=secrets.token_hex(8),
                source_data=DataSource.demo,
            )
        )
    db.flush()

    # -- integrations (honest connection states) ---------------------------- #
    integrations = [
        Integration(
            key="github",
            name="GitHub",
            category="source",
            description="Repository events, webhook deliveries and CI/CD triggers.",
            configured=False,
            config={"webhook_url": "/api/v1/repositories/webhook/github"},
            last_test_result="No token configured — add a PAT in Settings → Secrets.",
            last_test_ok=False,
        ),
        Integration(
            key="slack",
            name="Slack",
            category="notifications",
            description="Send alert notifications to a Slack channel.",
            configured=False,
            config={},
            last_test_result="Not configured.",
        ),
        Integration(
            key="discord",
            name="Discord",
            category="notifications",
            description="Post alerts to a Discord webhook URL.",
            configured=False,
            config={},
            last_test_result="Not configured.",
        ),
        Integration(
            key="email",
            name="Email (SMTP)",
            category="notifications",
            description="Deliver alert digests over SMTP.",
            configured=False,
            config={},
            last_test_result="Not configured.",
        ),
    ]
    db.add_all(integrations)

    # -- settings + audit ---------------------------------------------------- #
    db.add(
        AppSettings(
            site_name="DeploySphere",
            demo_mode=True,
            production_approval_required=True,
            deduplicate_alerts=True,
            alert_cooldown_seconds=300,
            retention_days=30,
        )
    )
    audit_entries = [
        (users[0], "settings.update", "settings", "1", "Enabled demo mode"),
        (users[0], "user.invite", "user", users[2].email, "Invited viewer account"),
        (users[1], "pipeline.update", "pipeline", "2", "Disabled auto-trigger on pull_request"),
        (users[0], "deployment.production", "deployment", "1", "Approved production rollout 2.14.3"),
        (users[1], "alert.acknowledge", "alert", "2", "Acknowledged disk usage warning"),
        (users[0], "integration.configure", "integration", "github", "Cleared stored GitHub token"),
    ]
    for actor, action, rtype, rid, detail in audit_entries:
        db.add(
            AuditEvent(
                actor_id=actor.id,
                actor_email=actor.email,
                action=action,
                resource_type=rtype,
                resource_id=rid,
                detail=detail,
                ip_address="127.0.0.1",
                created_at=_ts(rng.uniform(60, 60 * 24 * 5)),
            )
        )

    db.commit()
    return {
        "users": len(users),
        "repositories": len(repos),
        "pipelines": len(pipelines),
        "runs": len(runs),
        "servers": len(servers),
        "applications": len(applications),
        "deployments": len(deployments),
        "alerts": len(alert_defs),
        "logs": 420,
        "integrations": len(integrations),
    }


def reset_demo_data(db: Session) -> dict:
    """Drop all rows and re-seed (demo 'reset' control)."""
    from .database import Base

    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()
    return seed_demo_data(db)
