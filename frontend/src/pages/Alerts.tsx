// @ts-nocheck
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Check,
  CheckCircle2,
  Filter,
  Moon,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import { useServerEvent } from "../lib/live-status";
import type { Alert, AlertListResponse } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Select } from "../components/ui/input";
import { Tabs } from "../components/ui/tabs";
import { StatusBadge, Badge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { Modal } from "../components/ui/dialog";
import { formatRelative, formatDuration } from "../lib/utils";
import { TimeRangePicker, type RangeKey } from "../components/TimeRangePicker";

const RANGE_HOURS: Record<RangeKey, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };

const SEVERITIES = ["critical", "warning", "info"] as const;

function severityIcon(severity: string) {
  if (severity === "critical") return <XCircle className="h-4 w-4 text-red-400" />;
  if (severity === "warning") return <BellRing className="h-4 w-4 text-amber-400" />;
  return <BellRing className="h-4 w-4 text-cyan-400" />;
}

export function AlertsPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>("7d");
  const [tab, setTab] = useState<string>("open");
  const [severity, setSeverity] = useState("");
  const [serverId, setServerId] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Alert | null>(null);

  const params = new URLSearchParams();
  if (tab !== "all") params.set("status", tab);
  if (severity) params.set("severity", severity);
  if (serverId) params.set("server_id", serverId);
  if (q) params.set("q", q);
  params.set("hours", String(RANGE_HOURS[range]));
  params.set("limit", "100");

  const { data, isLoading, error, refetch } = useApi<AlertListResponse>(`/alerts?${params}`);

  // Server count for the filter dropdown.
  const { data: servers } = useApi<{ items: { id: number; name: string }[] }>("/servers?limit=100");

  // A new alert pushed over WS invalidates the list after a short delay.
  const [pending, setPending] = useState(false);
  useServerEvent("alert.created", () => {
    setPending(true);
    window.setTimeout(() => {
      refetch();
      setPending(false);
    }, 1200);
  });

  const counts = data?.counts ?? { open: 0, acknowledged: 0, muted: 0, resolved: 0, critical: 0, warning: 0, info: 0 };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["api"] });
  };

  const acknowledge = useApiMutation<number, unknown>(
    (id) => apiAlertAction(id, "acknowledge"),
    {
      successMessage: "Alert acknowledged",
      onSuccess: invalidate,
    },
  );

  const resolve = useApiMutation<number, unknown>((id) => apiAlertAction(id, "resolve"), {
    successMessage: "Alert resolved",
    onSuccess: invalidate,
  });

  const mute = useApiMutation<{ id: number; hours: number }, unknown>(
    ({ id, hours }) => apiAlertAction(id, "mute", hours),
    {
      successMessage: "Alert snoozed",
      onSuccess: invalidate,
    },
  );

  const tabs = [
    { id: "open", label: "Open", count: counts.open },
    { id: "acknowledged", label: "Acknowledged", count: counts.acknowledged },
    { id: "muted", label: "Muted", count: counts.muted },
    { id: "resolved", label: "Resolved", count: counts.resolved },
    { id: "all", label: "All", count: counts.open + counts.acknowledged + counts.muted + counts.resolved },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Alerts &amp; Events</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Deduplicated, grouped operational alerts with cooldown protection —{" "}
            <span className="text-amber-400">{counts.critical} critical</span>,{" "}
            <span className="text-amber-400">{counts.warning} warning</span> open right now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <Badge tone="cyan" dot>processing event…</Badge>}
          <TimeRangePicker value={range} onChange={setRange} />
          <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isLoading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              placeholder="Search alerts…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Select value={serverId} onChange={(e) => setServerId(e.target.value)} aria-label="Server">
            <option value="">All servers</option>
            {servers?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2 text-xs text-ink-faint xl:col-span-2">
            <Filter className="h-3.5 w-3.5" />
            Filters apply to both live and historical alerts.
          </div>
        </div>
      </Card>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <Card>
        {error ? (
          <ErrorState message={error.message} onRetry={refetch} />
        ) : isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No alerts match your filters"
            description="Try widening the time range or clearing the severity/server filters. Alerts appear here when thresholds are breached or deployments fail."
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          />
        ) : (
          <Table>
            <THead>
              <TH>Severity</TH>
              <TH>Alert</TH>
              <TH className="hidden md:table-cell">Source</TH>
              <TH className="hidden lg:table-cell">Target</TH>
              <TH>Time</TH>
              <TH className="text-right">Actions</TH>
            </THead>
            <TBody>
              {data.items.map((alert) => (
                <TR key={alert.id} onClick={() => setSelected(alert)}>
                  <TD>
                    <div className="flex items-center gap-2">
                      {severityIcon(alert.severity)}
                      <StatusBadge status={alert.severity} />
                    </div>
                  </TD>
                  <TD>
                    <p className="font-medium text-ink">{alert.title}</p>
                    <p className="mt-0.5 max-w-md truncate text-xs text-ink-faint">
                      {alert.message}
                    </p>
                    {alert.cooldown_until && alert.status !== "resolved" && (
                      <span className="text-[10px] text-amber-400/80">
                        deduplicated · next event after {formatRelative(alert.cooldown_until)}
                      </span>
                    )}
                  </TD>
                  <TD className="hidden md:table-cell">
                    <Badge tone="slate">{alert.source}</Badge>
                    {alert.count > 1 && (
                      <Badge tone="amber" className="ml-1">
                        ×{alert.count}
                      </Badge>
                    )}
                  </TD>
                  <TD className="hidden max-w-40 truncate lg:table-cell">
                    {alert.server_name ?? alert.application_name ?? "—"}
                  </TD>
                  <TD className="whitespace-nowrap text-xs">
                    <div>{formatRelative(alert.created_at)}</div>
                    <div className="text-ink-faint">
                      {formatDuration(
                        Math.max(0, (Date.now() - new Date(alert.created_at).getTime()) / 1000),
                      )} ago
                    </div>
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {alert.status === "open" && (
                        <Button size="sm" variant="secondary" onClick={() => acknowledge.mutate(alert.id)}>
                          <Check className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Ack</span>
                        </Button>
                      )}
                      {alert.status !== "resolved" && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => resolve.mutate(alert.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Resolve</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Snooze for 2 hours"
                            onClick={() => mute.mutate({ id: alert.id, hours: 2 })}
                          >
                            <Moon className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Detail modal */}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ""}
        description={selected ? `Alert #${selected.id} · ${selected.source}` : undefined}
        footer={
          selected && (
            <>
              {selected.status === "open" && (
                <Button variant="primary" onClick={() => { acknowledge.mutate(selected.id); setSelected(null); }}>
                  Acknowledge
                </Button>
              )}
              {selected.status !== "resolved" && (
                <Button variant="secondary" onClick={() => { resolve.mutate(selected.id); setSelected(null); }}>
                  Mark resolved
                </Button>
              )}
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selected.severity} />
              <StatusBadge status={selected.status} />
              {selected.server_name && <Badge tone="slate">server: {selected.server_name}</Badge>}
              {selected.application_name && <Badge tone="slate">app: {selected.application_name}</Badge>}
              {selected.deployment_id && <Badge tone="violet">deployment #{selected.deployment_id}</Badge>}
            </div>
            <p className="leading-relaxed text-ink-muted">{selected.message}</p>
            {selected.suggested_action && (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                  Suggested next action
                </p>
                <p className="mt-1 text-sm text-ink-muted">{selected.suggested_action}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-ink-faint">First seen</p>
                <p className="mt-0.5 text-ink">{formatRelative(selected.created_at)}</p>
              </div>
              <div>
                <p className="text-ink-faint">Last seen</p>
                <p className="mt-0.5 text-ink">{formatRelative(selected.last_seen_at)}</p>
              </div>
              <div>
                <p className="text-ink-faint">Occurrences</p>
                <p className="mt-0.5 text-ink">{selected.count}</p>
              </div>
              <div>
                <p className="text-ink-faint">Delivery</p>
                <p className="mt-0.5 text-ink">{selected.delivery ?? "pending"}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function apiAlertAction(id: number, action: string, hours?: number) {
  return apiFetch(`/alerts/${id}/${action}`, {
    method: "POST",
    body: hours !== undefined ? { hours } : {},
  });
}
