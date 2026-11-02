import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Server,
  CheckCircle2,
  GitBranch,
  Rocket,
  AlertTriangle,
  ArrowRight,
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  X,
  BellRing,
} from "lucide-react";
import { useApi } from "../lib/hooks";
import { useServerEvent } from "../lib/live-status";
import type { DashboardSummary, DashboardMetrics, TelemetryMessage } from "../types";
import { MetricCard } from "../components/MetricCard";
import { TrendChart } from "../components/charts/TrendChart";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { StatusBadge, Badge, SourceBadge } from "../components/ui/badge";
import { Spinner, EmptyState, ErrorState } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatDuration, formatRelative, cn } from "../lib/utils";
import { TimeRangePicker, type RangeKey } from "../components/TimeRangePicker";

function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeKey>("24h");
  const { data, isLoading, error, refetch } = useApi<DashboardSummary>(
    `/dashboard/summary?range=${range}`,
  );

  // Live telemetry patches the headline metrics without a refetch.
  const [livePatch, setLivePatch] = useState<{ cpu?: number; memory?: number; disk?: number }>({});
  useServerEvent<TelemetryMessage>("metric.sample", (msg) => {
    setLivePatch((prev) => ({
      ...prev,
      cpu: msg.cpu,
      memory: msg.memory,
      disk: msg.disk,
    }));
  });

  // Trend data for the selected range — fetched per range, cached by react-query.
  const { data: trend } = useApi<DashboardMetrics>(`/dashboard/metrics?range=${range}`, {
    refetchInterval: 60_000,
  });

  const summary = useMemo(() => {
    if (!data) return null;
    return {
      total: data.server_counts.total,
      healthy: data.server_counts.healthy,
      warning: data.server_counts.warning,
      critical: data.server_counts.critical + data.server_counts.offline,
      activePipelines: data.pipeline_counts.active,
      successful: data.deployment_counts.succeeded,
      failed: data.deployment_counts.failed,
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="card h-28 animate-pulse bg-surface-3/40" />
          ))}
        </div>
        <div className="flex justify-center py-16">
          <Spinner label="Loading dashboard…" />
        </div>
      </div>
    );
  }

  if (error || !data || !summary) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <ErrorState message={error?.message ?? "Dashboard data unavailable"} onRetry={refetch} />
      </div>
    );
  }

  const cpu = livePatch.cpu ?? data.fleet.cpu_percent;
  const memory = livePatch.memory ?? data.fleet.memory_percent;

  return (
    <div className="space-y-6">
      <PageHeading range={range} onRangeChange={setRange} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard
          label="Total servers"
          value={summary.total}
          status="info"
          icon={<Server className="h-4 w-4" />}
          source={data.data_source}
          onClick={() => navigate("/servers")}
        />
        <MetricCard
          label="Healthy"
          value={summary.healthy}
          status="healthy"
          icon={<CheckCircle2 className="h-4 w-4" />}
          onClick={() => navigate("/servers")}
        />
        <MetricCard
          label="Degraded"
          value={summary.warning}
          status={summary.warning > 0 ? "warning" : "muted"}
          sub={`${summary.critical} critical/offline`}
          icon={<AlertTriangle className="h-4 w-4" />}
          onClick={() => navigate("/servers")}
        />
        <MetricCard
          label="Active pipelines"
          value={summary.activePipelines}
          status="info"
          icon={<GitBranch className="h-4 w-4" />}
          onClick={() => navigate("/pipelines")}
        />
        <MetricCard
          label="Deployments OK"
          value={summary.successful}
          status="healthy"
          sub="last 24h"
          icon={<Rocket className="h-4 w-4" />}
          onClick={() => navigate("/deployments")}
        />
        <MetricCard
          label="Deployments failed"
          value={summary.failed}
          status={summary.failed > 0 ? "critical" : "muted"}
          sub="last 24h"
          icon={<X className="h-4 w-4" />}
          onClick={() => navigate("/deployments")}
        />
        <MetricCard
          label="Open alerts"
          value={data.alert_counts.open}
          status={
            data.alert_counts.critical > 0
              ? "critical"
              : data.alert_counts.open > 0
                ? "warning"
                : "healthy"
          }
          sub={`${data.alert_counts.critical} critical · ${data.alert_counts.acknowledged} acked`}
          icon={<BellRing className="h-4 w-4" />}
          onClick={() => navigate("/alerts")}
        />
      </div>

      {/* Live host metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "CPU utilization", value: cpu, icon: <Cpu className="h-4 w-4" />, color: "#38bdf8" },
          { label: "Memory utilization", value: memory, icon: <MemoryStick className="h-4 w-4" />, color: "#818cf8" },
          {
            label: "Disk utilization",
            value: livePatch.disk ?? data.fleet.disk_percent,
            icon: <HardDrive className="h-4 w-4" />,
            color: "#fbbf24",
          },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.label}</p>
              <div className="flex items-center gap-1.5 text-ink-faint">
                {m.icon}
                <SourceBadge source={data.data_source} />
              </div>
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums text-ink">
              {m.value}
              <span className="text-base font-medium text-ink-faint">%</span>
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-4">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  m.value >= 85 ? "bg-red-500" : m.value >= 70 ? "bg-amber-500" : "bg-emerald-500",
                )}
                style={{ width: `${Math.min(100, m.value)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              {m.value >= 85 ? "Above critical threshold (85%)" : m.value >= 70 ? "Above warning threshold (70%)" : "Within normal range"}
            </p>
          </Card>
        ))}
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title="CPU trend"
          description={`Average across monitored servers · last ${range}`}
          action={<Badge tone="cyan">cluster avg</Badge>}
        >
          <TrendChart
            data={
              trend
                ? trend.points.map((point) => ({ time: Date.parse(point.ts), value: point.cpu }))
                : []
            }
            series={[{ key: "value", label: "CPU %", color: "#38bdf8" }]}
            unit="%"
            yDomain={[0, 100]}
            height={230}
          />
          {!trend && <div className="flex justify-center py-10"><Spinner /></div>}
        </SectionCard>
        <SectionCard
          title="Memory trend"
          description={`Average across monitored servers · last ${range}`}
          action={<Badge tone="violet">cluster avg</Badge>}
        >
          <TrendChart
            data={
              trend
                ? trend.points.map((point) => ({ time: Date.parse(point.ts), value: point.memory }))
                : []
            }
            series={[{ key: "value", label: "Memory %", color: "#818cf8" }]}
            unit="%"
            yDomain={[0, 100]}
            height={230}
          />
          {!trend && <div className="flex justify-center py-10"><Spinner /></div>}
        </SectionCard>
      </div>

      {/* Lists row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Recent deployments"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate("/deployments")}>
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          }
        >
          {data.recent_deployments.length === 0 ? (
            <EmptyState compact title="No deployments yet" description="Trigger a pipeline to create your first deployment." />
          ) : (
            <ul className="space-y-2.5">
              {data.recent_deployments.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => navigate(`/deployments/${d.id}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{d.name}</p>
                      <p className="text-[11px] text-ink-faint">
                        {d.environment} · v{d.version} · {formatRelative(d.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Latest pipeline runs"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate("/pipelines")}>
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          }
        >
          {data.recent_runs.length === 0 ? (
            <EmptyState compact title="No pipeline runs" description="Run a pipeline to see execution history." />
          ) : (
            <ul className="space-y-2.5">
              {data.recent_runs.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => navigate(`/pipelines/${r.pipeline_id}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {r.pipeline?.name ?? `Pipeline #${r.pipeline_id}`}
                      </p>
                      <p className="truncate text-[11px] text-ink-faint">
                        {r.branch}@{r.commit_sha ? r.commit_sha.slice(0, 7) : "—"} ·{" "}
                        {formatRelative(r.queued_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.duration_seconds != null && (
                        <span className="text-[11px] tabular-nums text-ink-faint">
                          {formatDuration(r.duration_seconds)}
                        </span>
                      )}
                      <StatusBadge status={r.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Active alerts"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate("/alerts")}>
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          }
        >
          {data.recent_alerts.length === 0 ? (
            <EmptyState compact title="No recent alerts" description="Everything looks quiet. 🎉" />
          ) : (
            <ul className="space-y-2.5">
              {data.recent_alerts.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => navigate("/alerts")}
                    className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{a.title}</p>
                      <p className="text-[11px] text-ink-faint">
                        {a.source} · {formatRelative(a.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={a.severity} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Services table */}
      <SectionCard
        title="Service health"
        description="Application endpoints and their latest probe results"
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate("/applications")}>
            Manage <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        }
      >
        {data.services.length === 0 ? (
          <EmptyState compact title="No applications registered" description="Register an application to monitor its health endpoint." />
        ) : (
          <Table>
            <THead>
              <TH>Application</TH>
              <TH>Environment</TH>
              <TH>Status</TH>
              <TH className="text-right">Response</TH>
              <TH className="text-right">Error rate</TH>
              <TH className="hidden sm:table-cell text-right">Last checked</TH>
            </THead>
            <TBody>
              {data.services.map((s) => (
                <TR key={s.id} onClick={() => navigate("/applications")}>
                  <TD className="font-medium text-ink">{s.name}</TD>
                  <TD className="capitalize">{s.environment}</TD>
                  <TD>
                    <StatusBadge status={s.status} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {s.response_time_ms != null ? `${s.response_time_ms} ms` : "—"}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {s.error_rate_percent != null ? `${s.error_rate_percent}%` : "—"}
                  </TD>
                  <TD className="hidden text-right sm:table-cell">
                    {s.last_checked_at ? formatRelative(s.last_checked_at) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}

function PageHeading({ range, onRangeChange }: { range?: RangeKey; onRangeChange?: (r: RangeKey) => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-ink sm:text-2xl">Overview</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-faint">
          <Activity className="h-3.5 w-3.5" />
          Fleet, pipeline and deployment activity across your workspace
        </p>
      </div>
      {range && onRangeChange && <TimeRangePicker value={range} onChange={onRangeChange} />}
    </div>
  );
}
