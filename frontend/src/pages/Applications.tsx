// @ts-nocheck
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Plus,
  Search,
  Globe,
  Activity,
  Clock,
  Rocket,
} from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type { Application, ApplicationListResponse, Page as PageT } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Field } from "../components/ui/input";
import { Modal } from "../components/ui/dialog";
import { StatusBadge, SourceBadge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatRelative, cn } from "../lib/utils";

export function ApplicationsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    environment: "staging",
    health_url: "",
    repo_url: "",
    server_id: "",
  });

  const { data, isLoading, error, refetch } = useApi<ApplicationListResponse>(
    `/applications?limit=100${envFilter ? `&environment=${envFilter}` : ""}`,
    { refetchInterval: 30_000 },
  );
  const { data: servers } = useApi<PageT<{ id: number; name: string }>>("/servers?limit=100");

  const createApp = useApiMutation<object, Application>(
    (body) => apiFetch("/applications", { method: "POST", body }),
    {
      successMessage: (a) => `Application “${a.name}” registered`,
      onSuccess: () => {
        setCreateOpen(false);
        setForm({ name: "", environment: "staging", health_url: "", repo_url: "", server_id: "" });
        queryClient.invalidateQueries({ queryKey: ["api"] });
      },
    },
  );

  const filtered = (data?.items ?? []).filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );

  const statusStats = {
    healthy: (data?.items ?? []).filter((a) => a.status === "healthy").length,
    degraded: (data?.items ?? []).filter((a) => a.status === "degraded").length,
    down: (data?.items ?? []).filter((a) => a.status === "down").length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Applications</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Service health endpoints, response times and deployment status
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && <SourceBadge source={data.source} />}
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Register application
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Total apps
          </p>
          <p className="mt-1.5 text-2xl font-bold text-ink">{data?.items.length ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Healthy</p>
          <p className="mt-1.5 text-2xl font-bold text-emerald-400">{statusStats.healthy}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Degraded
          </p>
          <p className="mt-1.5 text-2xl font-bold text-amber-400">{statusStats.degraded}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Down</p>
          <p className="mt-1.5 text-2xl font-bold text-red-400">{statusStats.down}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            placeholder="Search applications…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {["", "development", "staging", "production"].map((env) => (
            <button
              key={env}
              onClick={() => setEnvFilter(env)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                envFilter === env
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-line bg-surface-2 text-ink-muted hover:bg-surface-3",
              )}
            >
              {env || "all"}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {error ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={search || envFilter ? "No applications match your filters" : "No applications yet"}
            description="Register an application with a health endpoint to monitor uptime, response time and structured errors."
            action={
              !search && !envFilter && (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Register application
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((app) => (
            <Card key={app.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                    <Boxes className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{app.name}</p>
                    <p className="text-[11px] text-ink-faint">
                      {app.environment} · {app.server_name ?? "unassigned host"}
                    </p>
                  </div>
                </div>
                <StatusBadge status={app.status} />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-surface-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-ink-faint">Response</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {app.response_time_ms != null ? `${app.response_time_ms}ms` : "—"}
                  </p>
                </div>
                <div className="rounded-md bg-surface-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-ink-faint">Uptime</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {app.uptime != null ? `${app.uptime}%` : "—"}
                  </p>
                </div>
                <div className="rounded-md bg-surface-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-ink-faint">Version</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-ink">
                    {app.last_deploy_version ?? "—"}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11px] text-ink-faint">
                <p className="flex items-center gap-1.5 truncate">
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono">{app.health_url}</span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  last deploy{" "}
                  {app.last_deploy_at ? formatRelative(app.last_deploy_at) : "never"}
                </p>
                <p className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3 shrink-0" />
                  monitored every 30s · {app.source}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Register modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Register an application"
        description="Adds a monitored service with a health-check endpoint."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createApp.isPending}
              onClick={() =>
                createApp.mutate({
                  name: form.name,
                  environment: form.environment,
                  health_url: form.health_url,
                  repo_url: form.repo_url || null,
                  server_id: form.server_id ? Number(form.server_id) : null,
                })
              }
            >
              Register
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. payments-api"
              />
            </Field>
            <Field label="Environment" required>
              <select
                className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink"
                value={form.environment}
                onChange={(e) => setForm({ ...form, environment: e.target.value })}
              >
                <option value="development">development</option>
                <option value="staging">staging</option>
                <option value="production">production</option>
              </select>
            </Field>
          </div>
          <Field label="Health check URL" required hint="Polled for status code and response time.">
            <Input
              value={form.health_url}
              onChange={(e) => setForm({ ...form, health_url: e.target.value })}
              placeholder="https://api.example.com/health"
            />
          </Field>
          <Field label="Repository URL">
            <Input
              value={form.repo_url}
              onChange={(e) => setForm({ ...form, repo_url: e.target.value })}
              placeholder="https://github.com/acme/payments-api"
            />
          </Field>
          <Field label="Host server">
            <select
              className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink"
              value={form.server_id}
              onChange={(e) => setForm({ ...form, server_id: e.target.value })}
            >
              <option value="">Not assigned</option>
              {servers?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="rounded-lg border border-line bg-surface-3 p-3 text-xs leading-relaxed text-ink-faint">
            <Rocket className="mr-1 inline h-3.5 w-3.5 text-ink-muted" />
            Deployments to this application appear in{" "}
            <span className="text-ink-muted">Deployments</span> with health-check results after each
            release.
          </div>
        </div>
      </Modal>
    </div>
  );
}
