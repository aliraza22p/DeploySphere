/**
 * Response shapes produced by the DeploySphere FastAPI backend.
 * These mirror `backend/app/schemas.py` exactly — keep them in sync.
 */

export interface Page<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
  counts?: any;
  source?: DataSource;
  [key: string]: any;
}

export type DataSource = "demo" | "live";
export type ServerStatus = "healthy" | "warning" | "critical" | "offline";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type DeploymentStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "rolled_back";
export type Environment = "development" | "staging" | "production";
export type Severity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "muted" | "resolved";
export type AppStatus = "healthy" | "degraded" | "down" | "unknown";

// ---------------------------------------------------------------- servers

export interface ServerOut {
  id: number;
  name: string;
  hostname: string;
  ip_address: string;
  region: string;
  operating_system: string;
  os?: string;
  environment: Environment;
  status: ServerStatus;
  agent_status: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  network_in_mbps: number;
  network_out_mbps: number;
  uptime_seconds: number;
  cpu_threshold: number;
  memory_threshold: number;
  disk_threshold: number;
  collection_interval_seconds: number;
  last_seen_at: string | null;
  agent_last_seen_at?: string | null;
  created_at: string;
  source?: DataSource;
  agent_token_preview?: string;
  services?: any[];
  [key: string]: any;
}

export interface ServerCreated extends ServerOut {
  agent_token: string;
  agent_token_warning: string;
}

export interface MetricPoint {
  ts: string;
  cpu: number;
  memory: number;
  disk: number;
  network: number;
}

export interface TelemetrySeries {
  data_source: DataSource;
  range: string;
  points: MetricPoint[];
}

export interface ServerSummary {
  server: ServerOut;
  uptime: string;
  freshness_seconds: number | null;
  thresholds_breached: { cpu: boolean; memory: boolean; disk: boolean };
  agent_online: boolean;
  sample_count: number;
}

/** `metric.sample` WebSocket payload. */
export interface MetricSampleMessage {
  server_id: number;
  name: string;
  status: ServerStatus;
  cpu: number;
  memory: number;
  disk: number;
  network_in: number;
  network_out: number;
  uptime_seconds: number;
}

// ---------------------------------------------------------------- dashboard

export interface DashboardSummary {
  data_source: DataSource;
  server_counts: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    offline: number;
  };
  pipeline_counts: Record<string, number>;
  deployment_counts: Record<string, number>;
  alert_counts: Record<string, number>;
  fleet: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    network_in_mbps: number;
    network_out_mbps: number;
  };
  uptime_seconds: number;
  series: MetricPoint[];
  deployment_trend: { day: string; succeeded: number; failed: number; total: number }[];
  recent_deployments: DeploymentOut[];
  recent_alerts: AlertOut[];
  recent_runs: PipelineRunOut[];
  services: ApplicationOut[];
  generated_at: string;
}

export interface DashboardMetrics {
  data_source: DataSource;
  range: string;
  points: MetricPoint[];
  generated_at: string;
}

// ---------------------------------------------------------------- applications

export interface ApplicationOut {
  id: number;
  name: string;
  server_id: number | null;
  environment: Environment;
  health_url: string;
  status: AppStatus;
  response_time_ms: number | null;
  http_status: number | null;
  error_rate_percent: number;
  version: string;
  last_checked_at: string | null;
  created_at: string;
  server: ServerOut | null;
}

// ---------------------------------------------------------------- deployments

export interface DeploymentOut {
  id: number;
  application_id: number | null;
  name: string;
  version: string;
  commit_sha: string;
  environment: Environment;
  status: DeploymentStatus;
  initiated_by: string;
  approved_by: string;
  notes: string;
  /** Full multi-line deployment log as one string. */
  log: string;
  health_check_result: string;
  rollback_of_id: number | null;
  requires_approval: boolean;
  source: DataSource;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  created_at: string;
}

// ---------------------------------------------------------------- alerts

export interface AlertOut {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  status: AlertStatus;
  source: string;
  server_id: number | null;
  application_id: number | null;
  deployment_id: number | null;
  suggested_action: string;
  occurrence_count: number;
  acknowledged_by: string;
  acknowledged_at: string | null;
  muted_until: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  server: ServerOut | null;
  application: ApplicationOut | null;
}

export interface AlertStats {
  open: number;
  acknowledged: number;
  muted: number;
  resolved: number;
  critical: number;
  warning: number;
  info: number;
  total: number;
}

/** `alert.created` WebSocket payload. */
export interface AlertMessage {
  alert_id: number;
  title: string;
  severity: Severity;
  server: string | null;
  ts: string;
  source: string;
}

// ---------------------------------------------------------------- logs

export interface LogOut {
  id: number;
  ts: string;
  source: string;
  severity: string;
  message: string;
  server_id: number | null;
  pipeline_run_id: number | null;
  deployment_id: number | null;
  trace_id: string;
  source_data: DataSource;
}

/** `log.created` WebSocket payload. */
export interface LogMessage {
  id?: number;
  severity: string;
  source: string;
  message: string;
  ts: string;
  source_data: DataSource;
  server_id?: number | null;
  pipeline_run_id?: number | null;
  deployment_id?: number | null;
  trace_id?: string;
}

// ---------------------------------------------------------------- pipelines

export interface StageDef {
  key: string;
  name: string;
  timeout_seconds: number;
}

export interface RepositoryOut {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  provider: string;
  default_branch: string;
  clone_url: string;
  connection_status: string;
  status_detail: string;
  webhook_configured: boolean;
  last_event_at: string | null;
  created_at: string;
}

export interface PipelineOut {
  id: number;
  name: string;
  repository_id: number;
  branch: string;
  triggers: string[];
  stages: StageDef[];
  enabled: boolean;
  timeout_seconds: number;
  environment: Environment;
  created_by: string;
  created_at: string;
  updated_at: string;
  repository: RepositoryOut | null;
  last_run: PipelineRunOut | null;
}

export interface PipelineRunOut {
  id: number;
  pipeline_id: number;
  number: number;
  status: RunStatus;
  commit_sha: string;
  commit_message: string;
  branch: string;
  triggered_by: string;
  trigger_event: string;
  artifact_version: string;
  source: DataSource;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  pipeline?: { id: number; name: string; environment: Environment };
  stages?: StageRunOut[];
}

export interface StageRunOut {
  id: number;
  key: string;
  name: string;
  position: number;
  status: RunStatus;
  attempt: number;
  /** Full stage log as one newline-delimited string. */
  log: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
}

export type PipelineRunDetail = PipelineRunOut;

// User type
export interface UserOut {
  id: number;
  email: string;
  full_name: string;
  role: "administrator" | "developer" | "viewer";
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}
export type User = UserOut;

// Aliases for compatibility with existing page imports
export type Pipeline = PipelineOut;
export type PipelineRun = PipelineRunOut;
export type RunListResponse = Page<PipelineRunOut>;
export type ServerDetail = ServerOut;
export type ServerListResponse = Page<ServerOut>;
export type Server = ServerOut;
export type SettingsResponse = SettingsOut;
export type TeamUser = UserOut;
export type Repository = RepositoryOut;
export type LogQueryResponse = Page<LogOut>;
export type TelemetryPoint = MetricPoint;
export type TelemetryMessage = MetricSampleMessage;
export type DeploymentDetail = DeploymentOut;
export type DeploymentListResponse = Page<DeploymentOut>;
export type Integration = IntegrationOut;
export type IntegrationDetail = IntegrationOut;
export type AuditListResponse = Page<AuditOut>;
export type AuditEvent = AuditOut;
export type ApplicationListResponse = Page<ApplicationOut>;
export type AlertListResponse = Page<AlertOut>;
export type LogListResponse = Page<LogOut>;

// ---------------------------------------------------------------- repositories

export interface RepositoryBranch {
  name: string;
  protected: boolean;
  source: DataSource;
}

export interface RepositoryCommit {
  sha: string;
  message: string;
  author: string;
  when: string;
  source: DataSource;
}

export interface RepositoryDetail {
  repository: RepositoryOut;
  branches: RepositoryBranch[];
  commits: RepositoryCommit[];
  pipelines: {
    id: number;
    name: string;
    branch: string;
    enabled: boolean;
    environment: Environment;
  }[];
  webhook: {
    configured: boolean;
    url: string;
    events: string[];
    signature_header: string;
  };
  setup_guidance: string[] | null;
  data_source: DataSource;
}

// ---------------------------------------------------------------- team / audit

export interface AuditOut {
  id: number;
  actor_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  detail: string;
  ip_address: string;
  created_at: string;
}

export interface InviteUserResult {
  user: UserOut;
  temporary_password: string | null;
  message: string;
}

// ---------------------------------------------------------------- integrations

export interface IntegrationOut {
  id: number;
  key: string;
  name: string;
  category: string;
  description: string;
  configured: boolean;
  config: Record<string, unknown>;
  last_tested_at: string | null;
  last_test_result: string;
  last_test_ok: boolean | null;
}

// ---------------------------------------------------------------- settings

export interface SettingsOut {
  id: number;
  site_name: string;
  timezone: string;
  retention_days: number;
  alert_cooldown_seconds: number;
  deduplicate_alerts: boolean;
  notify_email_enabled: boolean;
  notify_slack_enabled: boolean;
  notify_discord_enabled: boolean;
  production_approval_required: boolean;
  demo_mode: boolean;
  updated_at: string;
}
