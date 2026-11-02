"""Demo-mode simulator: advances telemetry, pipeline runs and deployments, and
broadcasts WebSocket events so the dashboard behaves like a live system.

Everything it produces is marked source="demo". It only ever mutates records
that are themselves demo/simulated data — it never fabricates live telemetry
for user-registered (agent-backed) servers.
"""

from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .config import settings
from .database import SessionLocal
from .models import (
    AgentStatus,
    Alert,
    AlertSeverity,
    AlertStatus,
    DataSource,
    Deployment,
    DeploymentStatus,
    PipelineRun,
    RunStatus,
    Server,
    ServerStatus,
    TelemetrySample,
)
from .security import redact_secrets
from .ws import manager

TICK_SECONDS = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class DemoSimulator:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stopping = asyncio.Event()
        self._tick_count = 0
        self._rng = random.Random()

    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        if not (settings.demo_mode and settings.simulator_enabled):
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._run(), name="demo-simulator")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        while not self._stopping.is_set():
            try:
                events = await asyncio.to_thread(self._tick)
                for event in events:
                    await manager.broadcast(event)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # keep the loop alive, log the failure
                print(f"[simulator] tick failed: {type(exc).__name__}: {exc}")
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=TICK_SECONDS)
            except asyncio.TimeoutError:
                continue

    # ------------------------------------------------------------------ #
    def _tick(self) -> list[dict]:
        """Run one simulation step (in a worker thread). Returns WS events."""
        self._tick_count += 1
        db = SessionLocal()
        try:
            events: list[dict] = []
            events.extend(self._advance_servers(db))
            events.extend(self._advance_runs(db))
            events.extend(self._advance_deployments(db))
            events.extend(self._check_thresholds(db))
            db.commit()
            return events
        finally:
            db.close()

    # -- telemetry ------------------------------------------------------- #
    def _advance_servers(self, db) -> list[dict]:
        servers = db.scalars(select(Server)).all()
        events: list[dict] = []
        persist = self._tick_count % max(1, settings.telemetry_persist_interval // TICK_SECONDS) == 0
        now = _now()
        for server in servers:
            # Only demo-owned servers (agent offline / seeded demo host) drift.
            if server.agent_status == AgentStatus.online and not settings.demo_mode:
                continue
            server.cpu_percent = round(
                min(99.0, max(2.0, server.cpu_percent + self._rng.uniform(-6, 6))), 1
            )
            server.memory_percent = round(
                min(98.0, max(8.0, server.memory_percent + self._rng.uniform(-3, 3))), 1
            )
            server.disk_percent = round(
                min(97.0, max(5.0, server.disk_percent + self._rng.uniform(-0.2, 0.3))), 1
            )
            server.network_in_mbps = round(max(0.1, self._rng.gauss(45, 20)), 2)
            server.network_out_mbps = round(max(0.1, self._rng.gauss(28, 12)), 2)
            server.uptime_seconds += TICK_SECONDS

            if server.status == ServerStatus.offline:
                server.agent_status = AgentStatus.offline
            else:
                server.agent_status = AgentStatus.online
                server.last_seen_at = now
                server.status = self._status_for(server)

            if persist and server.status != ServerStatus.offline:
                db.add(
                    TelemetrySample(
                        server_id=server.id,
                        ts=now,
                        cpu_percent=server.cpu_percent,
                        memory_percent=server.memory_percent,
                        disk_percent=server.disk_percent,
                        network_in_mbps=server.network_in_mbps,
                        network_out_mbps=server.network_out_mbps,
                        uptime_seconds=server.uptime_seconds,
                        source=DataSource.demo,
                    )
                )
            events.append(
                {
                    "type": "metric.sample",
                    "payload": {
                        "server_id": server.id,
                        "name": server.name,
                        "status": server.status.value,
                        "cpu": server.cpu_percent,
                        "memory": server.memory_percent,
                        "disk": server.disk_percent,
                        "network_in": server.network_in_mbps,
                        "network_out": server.network_out_mbps,
                        "uptime_seconds": server.uptime_seconds,
                        "source": "demo",
                        "ts": now.isoformat(),
                    },
                }
            )
        return events

    @staticmethod
    def _status_for(server: Server) -> ServerStatus:
        if (
            server.cpu_percent >= server.cpu_threshold
            or server.memory_percent >= server.memory_threshold
            or server.disk_percent >= server.disk_threshold
        ):
            return ServerStatus.critical
        if (
            server.cpu_percent >= server.cpu_threshold - 10
            or server.memory_percent >= server.memory_threshold - 8
            or server.disk_percent >= server.disk_threshold - 8
        ):
            return ServerStatus.warning
        return ServerStatus.healthy

    # -- pipeline runs ---------------------------------------------------- #
    def _advance_runs(self, db) -> list[dict]:
        events: list[dict] = []
        running = db.scalars(
            select(PipelineRun).where(PipelineRun.status == RunStatus.running)
        ).all()
        for run in running:
            stages = sorted(run.stages, key=lambda s: s.position)
            active = next((s for s in stages if s.status == RunStatus.running), None)
            now = _now()

            if active is None:
                active = next((s for s in stages if s.status == RunStatus.queued), None)
                if active is None:
                    run.status = RunStatus.succeeded
                    run.finished_at = now
                    run.duration_seconds = (
                        int((now - _ensure_utc(run.started_at)).total_seconds())
                        if run.started_at
                        else None
                    )
                    run.artifact_version = run.artifact_version or f"1.0.{run.number % 100}"
                    events.append(self._run_event(run))
                    continue
                active.status = RunStatus.running
                active.started_at = now
                db.flush()

            # finish the active stage
            fails = self._rng.random() < 0.06
            active.status = RunStatus.failed if fails else RunStatus.succeeded
            active.finished_at = now
            active.duration_seconds = self._rng.randint(5, 90)
            active.log = (
                (active.log + "\n" if active.log else "")
                + redact_secrets(
                    f"[stage:{active.key}] {'ERROR: command exited with code 1' if fails else 'completed successfully'}"
                )
            )
            if fails:
                run.status = RunStatus.failed
                run.finished_at = now
                run.duration_seconds = (
                    int((now - _ensure_utc(run.started_at)).total_seconds())
                    if run.started_at
                    else None
                )
            events.append(self._run_event(run, stage_id=active.id))
        return events

    @staticmethod
    def _run_event(run: PipelineRun, stage_id: int | None = None) -> dict:
        return {
            "type": "pipeline.run.updated",
            "payload": {
                "run_id": run.id,
                "pipeline_id": run.pipeline_id,
                "number": run.number,
                "status": run.status.value,
                "stage_id": stage_id,
                "finished_at": run.finished_at.isoformat() if run.finished_at else None,
                "source": "demo",
            },
        }

    # -- deployments ------------------------------------------------------ #
    def _advance_deployments(self, db) -> list[dict]:
        events: list[dict] = []
        active = db.scalars(
            select(Deployment).where(Deployment.status == DeploymentStatus.running)
        ).all()
        for deployment in active:
            now = _now()
            started = _ensure_utc(deployment.started_at) if deployment.started_at else now
            elapsed = (now - started).total_seconds()
            if elapsed < 12:
                continue
            succeeds = self._rng.random() < 0.85
            deployment.status = (
                DeploymentStatus.succeeded if succeeds else DeploymentStatus.failed
            )
            deployment.finished_at = now
            deployment.duration_seconds = int(elapsed)
            deployment.health_check_result = (
                "passed (200 OK)" if succeeds else "failed (503 Service Unavailable)"
            )
            deployment.log = redact_secrets(
                deployment.log
                + (
                    "\ndeploy: health check passed (200 OK, 91ms)\ndeploy: rollout complete"
                    if succeeds
                    else "\ndeploy: ERROR health check failed (503)\ndeploy: halted, previous revision retained"
                )
            )
            events.append(
                {
                    "type": "deployment.updated",
                    "payload": {
                        "deployment_id": deployment.id,
                        "name": deployment.name,
                        "version": deployment.version,
                        "environment": deployment.environment.value,
                        "status": deployment.status.value,
                        "source": "demo",
                    },
                }
            )
            if not succeeds:
                events.append(
                    {
                        "type": "log.created",
                        "payload": {
                            "severity": "error",
                            "source": "deployment",
                            "message": f"Deployment {deployment.name} {deployment.version} failed health verification",
                            "ts": now.isoformat(),
                            "source_data": "demo",
                        },
                    }
                )
        return events

    # -- alerts with dedup + cooldown ------------------------------------- #
    def _check_thresholds(self, db) -> list[dict]:
        if self._tick_count % 12 != 0:  # evaluate every ~60s
            return []
        settings_row = None
        cooldown_minutes = 30
        from .models import AppSettings

        settings_row = db.scalars(select(AppSettings).limit(1)).first()
        if settings_row is not None:
            cooldown_minutes = max(0, settings_row.alert_cooldown_seconds) // 60
        dedupe = settings_row.deduplicate_alerts if settings_row else True

        events: list[dict] = []
        servers = db.scalars(
            select(Server).where(Server.status.in_([ServerStatus.warning, ServerStatus.critical]))
        ).all()
        now = _now()
        for server in servers:
            breached = (
                server.cpu_percent >= server.cpu_threshold,
                server.memory_percent >= server.memory_threshold,
                server.disk_percent >= server.disk_threshold,
            )
            labels = ["CPU", "memory", "disk"]
            for breached_flag, label in zip(breached, labels):
                if not breached_flag:
                    continue
                dedup_key = f"{server.id}:{label.lower()}-threshold"
                existing = db.scalars(
                    select(Alert)
                    .where(Alert.dedup_key == dedup_key)
                    .where(Alert.status.in_([AlertStatus.open, AlertStatus.acknowledged]))
                ).first()
                if existing is not None:
                    if dedupe:
                        # group repeats instead of flooding
                        existing.occurrence_count += 1
                        existing.updated_at = now
                        continue
                    if existing.created_at > now - timedelta(minutes=cooldown_minutes):
                        continue
                alert = Alert(
                    title=f"{label} threshold breached on {server.name}",
                    description=(
                        f"{label} utilisation is at "
                        f"{server.cpu_percent if label == 'CPU' else server.memory_percent if label == 'memory' else server.disk_percent}%"
                        f" (threshold set on the server)."
                    ),
                    severity=(
                        AlertSeverity.critical
                        if server.status == ServerStatus.critical
                        else AlertSeverity.warning
                    ),
                    status=AlertStatus.open,
                    source="monitoring",
                    server_id=server.id,
                    suggested_action=f"Inspect {label} usage on {server.name} and scale or clean up if sustained.",
                    dedup_key=dedup_key,
                    created_at=now,
                )
                db.add(alert)
                db.flush()
                events.append(
                    {
                        "type": "alert.created",
                        "payload": {
                            "alert_id": alert.id,
                            "title": alert.title,
                            "severity": alert.severity.value,
                            "server": server.name,
                            "ts": now.isoformat(),
                            "source": "demo",
                        },
                    }
                )
        return events


simulator = DemoSimulator()
