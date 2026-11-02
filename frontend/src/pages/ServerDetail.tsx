// @ts-nocheck
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Server as ServerIcon,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  Wifi,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type {
  ApplicationOut,
  Page,
  ServerDetail as ServerDetailT,
  TelemetryMessage,
  TelemetrySeries,
} from "../types";
import { MetricCard } from "../components/MetricCard";
import { TrendChart } from "../components/charts/TrendChart";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { StatusBadge, Badge } from "../components/ui/badge";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { ConfirmDialog } from "../components/ui/dialog";
import { LogViewer } from "../components/LogViewer";
import { formatRelative, formatUptime, cn } from "../lib/utils";
import { TimeRangePicker, type RangeKey } from "../components/TimeRangePicker";
import { useServerEvent } from "../lib/live-status";

export function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const serverId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>("24h");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [live, setLive] = useState<Partial<TelemetryMessage> | null>(null);

  const { data: server, isLoading, error, refetch } = useApi<ServerDetailT>(
    Number.isFinite(serverId) ? `/servers/${serverId}` : null,
    { refetchInterval: 30_000 },
  );

  const { data: history } = useApi<TelemetrySeries>(
    Number.isFinite(serverId)
      ? `/servers/${serverId}/metrics?range=${range}`
      : null,
    { refetchInterval: 60_000 },
  );
  const { data: applications } = useApi<Page<ApplicationOut>>("/applications?page_size=200");

  useServerEvent<TelemetryMessage>("metric.sample", (msg) => {
    if (msg.server_id === serverId) setLive(msg);
  });

  const removeServer = useApiMutation<number, unknown>(
    (sid) => apiFetch(`/servers/${sid}`, { method: "DELETE" }),
    {
      successMessage: "Server removed",
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["api"] });
        navigate("/servers");
      },
    },
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Loading server…" />
      </div>
    );
  }

  if (error || !server) {
    return (
      <div className="space-y-4">
        <BackButton onClick={() => navigate("/servers")} />
        <ErrorState message={error?.message ?? "Server not found"} onRetry={refetch} />
      </div>
    );
  }

  const cpu = live?.cpu ?? server.cpu_percent;
  const memory = live?.memory ?? server.memory_percent;
  const disk = live?.disk ?? server.disk_percent;
  const uptime = live?.uptime_seconds ?? server.uptime_seconds;

  const points = history?.points ?? [];
  const services = applications?.items.filter((application) => application.server_id === serverId) ?? [];
  const chartPoints = points.map((point) => ({
    time: Date.parse(point.ts),
    cpu: point.cpu,
    memory: point.memory,
    disk: point.disk,
    network: point.network,
  }));

  return (
    <div className="space-y-5">
      <BackButton onClick={() => navigate("/servers")} />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-4 text-ink-muted">
            <ServerIcon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold text-ink sm:text-2xl">{server.name}</h1>
              <StatusBadge status={server.status} />
            </div>
            <p className="mt-1 font-mono text-sm text-ink-faint">
              {server.hostname}
              {server.ip_address && (
                <>
                  {" · "}
                  <span className="text-ink-muted">{server.ip_address}</span>
                </>
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone="slate">{server.operating_system}</Badge>
              {server.region && <Badge tone="slate">{server.region}</Badge>}
              <Badge tone={server.last_seen_at ? "green" : "amber"}>
                <Wifi className="mr-1 h-3 w-3" />
                agent {server.last_seen_at ? `seen ${formatRelative(server.last_seen_at)}` : "never seen"}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      </div>

      {/* Live metrics */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          label="CPU"
          value={cpu ?? "—"}
          unit="%"
          status={(cpu ?? 0) >= 85 ? "critical" : (cpu ?? 0) >= 70 ? "warning" : "healthy"}
          icon={<Cpu className="h-4 w-4" />}
          live={Boolean(live)}
        />
        <MetricCard
          label="Memory"
          value={memory ?? "—"}
          unit="%"
          status={(memory ?? 0) >= 85 ? "critical" : (memory ?? 0) >= 70 ? "warning" : "healthy"}
          icon={<MemoryStick className="h-4 w-4" />}
          live={Boolean(live)}
        />
        <MetricCard
          label="Disk"
          value={disk ?? "—"}
          unit="%"
          status={(disk ?? 0) >= 90 ? "critical" : (disk ?? 0) >= 80 ? "warning" : "healthy"}
          icon={<HardDrive className="h-4 w-4" />}
        />
        <MetricCard
          label="Uptime"
          value={formatUptime(uptime).split(" ")[0]}
          unit={formatUptime(uptime).split(" ").slice(1).join(" ") || undefined}
          status="muted"
          icon={<Activity className="h-4 w-4" />}
          sub={server.last_seen_at ? `last seen ${formatRelative(server.last_seen_at)}` : "no data yet"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Historical telemetry
        </h2>
        <TimeRangePicker value={range} onChange={setRange} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            CPU &amp; memory %
          </p>
          {points.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-ink-faint">
              No telemetry recorded for this range yet.
            </div>
          ) : (
            <TrendChart
              data={chartPoints}
              series={[
                { key: "cpu", label: "CPU %", color: "#38bdf8" },
                { key: "memory", label: "Memory %", color: "#818cf8" },
              ]}
              unit="%"
              yDomain={[0, 100]}
              height={224}
            />
          )}
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Disk % &amp; network MB/s
          </p>
          {points.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-ink-faint">
              No telemetry recorded for this range yet.
            </div>
          ) : (
            <TrendChart
              data={chartPoints}
              series={[
                { key: "disk", label: "Disk %", color: "#fbbf24" },
                { key: "network", label: "Network MB/s", color: "#34d399" },
              ]}
              height={224}
            />
          )}
        </Card>
      </div>

      {/* Services */}
      <Card>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Services on this host</h2>
        </div>
        {services.length === 0 ? (
          <EmptyState
            compact
            title="No services mapped"
            description="Applications assigned to this server will appear here."
          />
        ) : (
          <ul className="divide-y divide-line/70">
            {services.map((svc) => (
              <li key={svc.name} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-ink">{svc.name}</span>
                <StatusBadge status={svc.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Logs */}
      <Card>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Server logs</h2>
          <p className="text-xs text-ink-faint">Live-tailed entries from this host</p>
        </div>
        <LogViewer
          filters={{ server_id: server.id, hours: 24, limit: 300 }}
          emptyTitle="No logs for this server"
          emptyDescription="Log records tagged with this server will stream here."
        />
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => removeServer.mutate(server.id)}
        loading={removeServer.isPending}
        danger
        confirmLabel="Remove server"
        title="Remove server?"
        message={
          <>
            <strong>{server.name}</strong> and its telemetry history will be deleted. The monitoring
            agent will lose authentication and stop reporting.
          </>
        }
      />
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded text-sm text-ink-muted hover:text-ink",
        "focus-visible:ring-2 focus-visible:ring-accent/70",
      )}
    >
      <ArrowLeft className="h-4 w-4" /> All servers
    </button>
  );
}
