// @ts-nocheck
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Server as ServerIcon,
  Plus,
  Search,
  Copy,
  Check,
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
} from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type { ServerListResponse, Server, TelemetryMessage } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Field } from "../components/ui/input";
import { Modal } from "../components/ui/dialog";
import { StatusBadge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatRelative, formatUptime, cn } from "../lib/utils";
import { useServerEvent } from "../lib/live-status";
import { Tabs } from "../components/ui/tabs";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "healthy"
      ? "bg-emerald-400"
      : status === "warning"
        ? "bg-amber-400"
        : status === "critical"
          ? "bg-red-500"
          : "bg-slate-500";
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {status !== "offline" && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", color)} />
      )}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", color)} />
    </span>
  );
}

function MeterBar({ label, value, icon }: { label: string; value: number | null; icon: ReactNode }) {
  const display = value ?? 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1 text-ink-faint">
          {icon}
          {label}
        </span>
        <span className="tabular-nums text-ink-muted">{value != null ? `${Math.round(value)}%` : "—"}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-4">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            display >= 85 ? "bg-red-500" : display >= 70 ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${Math.min(100, display)}%` }}
        />
      </div>
    </div>
  );
}

export function ServersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<(Server & { agent_token: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", hostname: "", ip_address: "", os: "linux", region: "" });

  const { data, isLoading, error, refetch } = useApi<ServerListResponse>(
    "/servers?page_size=200",
    { refetchInterval: 20_000 },
  );

  // Patch live telemetry into the list without a refetch.
  const [live, setLive] = useState<Record<number, Partial<Server>>>({});
  useServerEvent<TelemetryMessage>("metric.sample",
    (msg) =>
      setLive((prev) => ({
        ...prev,
        [msg.server_id]: {
          cpu_percent: msg.cpu,
          memory_percent: msg.memory,
          disk_percent: msg.disk,
        },
      })),
  );

  const createServer = useApiMutation<object, Server & { agent_token: string }>(
    (body) => apiFetch("/servers", { method: "POST", body }),
    {
      successMessage: (s) => `Server “${s.name}” registered`,
      onSuccess: (s) => {
        setCreated(s);
        setCreateOpen(false);
        setForm({ name: "", hostname: "", ip_address: "", os: "linux", region: "" });
        queryClient.invalidateQueries({ queryKey: ["api"] });
      },
    },
  );

  const servers = (data?.items ?? []).map((s) => ({ ...s, ...(live[s.id] ?? {}) }));
  const filtered = servers.filter(
    (s) => {
      const matchesStatus = !statusFilter || s.status === statusFilter;
      const matchesSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.hostname.toLowerCase().includes(search.toLowerCase()) ||
        (s.ip_address ?? "").includes(search);
      return matchesStatus && matchesSearch;
    },
  );

  const copyToken = async () => {
    if (!created?.agent_token) return;
    await navigator.clipboard.writeText(created.agent_token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const tabs = [
    { id: "", label: "All", count: servers.length },
    { id: "healthy", label: "Healthy", count: servers.filter((s) => s.status === "healthy").length },
    { id: "warning", label: "Warning", count: servers.filter((s) => s.status === "warning").length },
    { id: "critical", label: "Critical", count: servers.filter((s) => s.status === "critical").length },
    { id: "offline", label: "Offline", count: servers.filter((s) => s.status === "offline").length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Servers</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Registered hosts reporting through authenticated monitoring agents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Register server
          </Button>
        </div>
      </div>

      <Tabs tabs={tabs} active={statusFilter} onChange={setStatusFilter} />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <Input
          placeholder="Search by name, hostname or IP…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {error ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={search || statusFilter ? "No servers match your filters" : "No servers registered"}
            description={
              search || statusFilter
                ? "Clear the search or pick a different status tab."
                : "Register a server to start collecting CPU, memory, disk and network telemetry via the monitoring agent."
            }
            action={
              !search && !statusFilter && (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Register your first server
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((server) => (
            <Card
              key={server.id}
              className="group cursor-pointer p-4 transition-colors hover:border-accent/50"
              onClick={() => navigate(`/servers/${server.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-4 text-ink-muted group-hover:text-accent">
                    <ServerIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{server.name}</p>
                    <p className="truncate font-mono text-[11px] text-ink-faint">
                      {server.hostname}
                      {server.ip_address && <> · {server.ip_address}</>}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={server.status} />
                    <StatusBadge status={server.status} />
                  </div>
                  <StatusBadge status={server.agent_status} label={`${server.agent_status} agent`} />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5">
                <MeterBar label="CPU" value={server.cpu_percent} icon={<Cpu className="h-3 w-3" />} />
                <MeterBar
                  label="Memory"
                  value={server.memory_percent}
                  icon={<MemoryStick className="h-3 w-3" />}
                />
                <MeterBar label="Disk" value={server.disk_percent} icon={<HardDrive className="h-3 w-3" />} />
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-ink-faint">
                <span className="flex items-center gap-1">
                  <Wifi className="h-3 w-3" />
                  {server.last_seen_at
                    ? `agent ${formatRelative(server.last_seen_at)}`
                    : "agent never seen"}
                </span>
                <span className="tabular-nums">up {formatUptime(server.uptime_seconds)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Register modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Register a server"
        description="Creates the server record and issues an agent token for authenticated telemetry."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createServer.isPending}
              onClick={() =>
                createServer.mutate({
                  name: form.name,
                  hostname: form.hostname,
                  ip_address: form.ip_address,
                  operating_system: form.os,
                  region: form.region || "local",
                })
              }
            >
              Register server
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Display name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. prod-web-01"
              />
            </Field>
            <Field label="Hostname" required>
              <Input
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                placeholder="e.g. web01.example.com"
              />
            </Field>
            <Field label="IP address">
              <Input
                value={form.ip_address}
                onChange={(e) => setForm({ ...form, ip_address: e.target.value })}
                placeholder="e.g. 10.0.0.12"
              />
            </Field>
            <Field label="OS">
              <select
                className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink"
                value={form.os}
                onChange={(e) => setForm({ ...form, os: e.target.value })}
              >
                <option value="linux">linux</option>
                <option value="macos">macos</option>
                <option value="windows">windows</option>
              </select>
            </Field>
          </div>
          <Field label="Region / location">
            <Input
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              placeholder="e.g. eu-west-1"
            />
          </Field>
          <p className="rounded-lg border border-line bg-surface-3 p-3 text-xs leading-relaxed text-ink-faint">
            After registration you&apos;ll receive an <span className="text-ink-muted">agent token</span>.
            Configure it in the monitoring agent&apos;s environment — it is never exposed to the browser
            again after creation.
          </p>
        </div>
      </Modal>

      {/* Token modal (shown once after creation) */}
      <Modal
        open={Boolean(created)}
        onClose={() => setCreated(null)}
        title="Server registered"
        description="Copy the agent token now — it cannot be retrieved later."
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            Done
          </Button>
        }
      >
        {created && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300">
              <Check className="h-4 w-4" /> {created.name} is ready for telemetry.
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Agent token (preview)</p>
              <div className="flex gap-2">
                <code className="flex-1 overflow-x-auto rounded-md border border-line bg-[#0a0f1a] px-3 py-2 font-mono text-xs text-cyan-300">
                  {created.agent_token}
                </code>
                <Button variant="secondary" onClick={copyToken}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface-3 p-3 font-mono text-[11px] leading-relaxed text-ink-faint">
              <p className="mb-1 font-sans font-semibold text-ink-muted">Agent configuration</p>
              <p>DEPLOYSPHERE_URL=http://localhost:8000</p>
              <p>AGENT_TOKEN={created.agent_token}</p>
              <p>SERVER_ID={created.id}</p>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
