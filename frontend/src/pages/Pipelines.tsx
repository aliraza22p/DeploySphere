// @ts-nocheck
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus, Play, Search, Clock, XCircle } from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";

import type { Pipeline, RunListResponse, Page as PageT, RepositoryOut } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Field } from "../components/ui/input";
import { Modal, ConfirmDialog } from "../components/ui/dialog";
import { StatusBadge, Badge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatRelative, formatDuration, shortSha } from "../lib/utils";

const DEFAULT_STAGES = [
  { key: "checkout", name: "Checkout", timeout_seconds: 300 },
  { key: "install", name: "Install", timeout_seconds: 300 },
  { key: "build", name: "Build", timeout_seconds: 300 },
  { key: "test", name: "Test", timeout_seconds: 300 },
  { key: "lint", name: "Lint", timeout_seconds: 300 },
  { key: "package", name: "Package", timeout_seconds: 300 },
  { key: "deploy", name: "Deploy", timeout_seconds: 300 },
  { key: "health_check", name: "Health check", timeout_seconds: 300 },
];

export function PipelinesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [runTarget, setRunTarget] = useState<Pipeline | null>(null);
  const [runCommit, setRunCommit] = useState("");
  const [form, setForm] = useState({
    name: "",
    branch: "main",
    repository_id: "",
    triggers: "push",
  });

  const { data, isLoading, error, refetch } = useApi<PageT<Pipeline>>(
    "/pipelines?page_size=100",
    { refetchInterval: 15_000 },
  );
  const { data: runs } = useApi<RunListResponse>("/pipeline-runs?page_size=10", {
    refetchInterval: 15_000,
  });
  const { data: repos } = useApi<RepositoryOut[]>("/repositories");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["api"] });

  const createPipeline = useApiMutation<object, Pipeline>(
    (body) => apiFetch("/pipelines", { method: "POST", body }),
    {
      successMessage: (p) => `Pipeline “${p.name}” created`,
      onSuccess: () => {
        setCreateOpen(false);
        setForm({ name: "", branch: "main", repository_id: "", triggers: "push" });
        invalidate();
      },
    },
  );

  const triggerRun = useApiMutation<{ id: number; body: object }, { id: number }>(
    ({ id, body }) => apiFetch(`/pipelines/${id}/run`, { method: "POST", body }),
    {
      successMessage: "Pipeline run triggered",
      onSuccess: (run) => {
        setRunTarget(null);
        setRunCommit("");
        invalidate();
        navigate(`/pipelines/${runTarget?.id}`);
      },
    },
  );

  const togglePipeline = useApiMutation<{ id: number; enabled: boolean }, unknown>(
    ({ id, enabled }) =>
      apiFetch(`/pipelines/${id}`, { method: "PATCH", body: { enabled } }),
    {
      successMessage: "Pipeline updated",
      onSuccess: invalidate,
    },
  );

  const deletePipeline = useApiMutation<number, unknown>(
    (id) => apiFetch(`/pipelines/${id}`, { method: "DELETE" }),
    {
      successMessage: "Pipeline deleted",
      onSuccess: invalidate,
    },
  );

  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);

  const filtered = (data?.items ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.repository?.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Pipelines</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Multi-stage CI/CD definitions with isolated, timeout-bounded jobs
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New pipeline
        </Button>
      </div>

      {/* Filter */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <Input
          placeholder="Search pipelines…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        {error ? (
          <ErrorState message={error.message} onRetry={refetch} />
        ) : isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search ? "No pipelines match your search" : "No pipelines yet"}
            description={
              search
                ? "Try a different search term."
                : "Create a pipeline to define stages: checkout → install → build → test → lint → package → deploy → health check."
            }
            action={
              !search && (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create your first pipeline
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <THead>
              <TH>Pipeline</TH>
              <TH className="hidden md:table-cell">Repository</TH>
              <TH className="hidden lg:table-cell">Branch</TH>
              <TH>Stages</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </THead>
            <TBody>
              {filtered.map((p) => (
                <TR key={p.id} onClick={() => navigate(`/pipelines/${p.id}`)}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/15 text-accent">
                        <GitBranch className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-ink">{p.name}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">{p.repository?.name ?? "—"}</TD>
                  <TD className="hidden lg:table-cell">
                    <Badge tone="cyan">{p.branch}</Badge>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {p.stages.slice(0, 4).map((s) => (
                        <Badge key={s.key} tone="slate" className="text-[10px]">
                          {s.name}
                        </Badge>
                      ))}
                      {p.stages.length > 4 && (
                        <Badge tone="slate" className="text-[10px]">
                          +{p.stages.length - 4}
                        </Badge>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <StatusBadge status={p.enabled ? "healthy" : "offline"} label={p.enabled ? "enabled" : "disabled"} />
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="primary"
                        title="Trigger a run"
                        onClick={() => setRunTarget(p)}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => togglePipeline.mutate({ id: p.id, enabled: !p.enabled })}
                      >
                        {p.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(p)}>
                        <XCircle className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Recent runs */}
      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Recent runs</h2>
          <Badge tone="slate">{runs?.total ?? 0} total</Badge>
        </div>
        {!runs || runs.items.length === 0 ? (
          <EmptyState compact title="No runs yet" description="Trigger a pipeline to see run history." />
        ) : (
          <Table>
            <THead>
              <TH>Pipeline</TH>
              <TH className="hidden sm:table-cell">Commit</TH>
              <TH>Status</TH>
              <TH className="text-right">Duration</TH>
              <TH className="hidden md:table-cell text-right">Started</TH>
            </THead>
            <TBody>
              {runs.items.map((r) => (
                <TR key={r.id} onClick={() => navigate(`/pipelines/${r.pipeline_id}`)}>
                  <TD className="font-medium text-ink">{r.pipeline?.name ?? `Pipeline #${r.pipeline_id}`}</TD>
                  <TD className="hidden font-mono text-xs sm:table-cell">
                    {shortSha(r.commit_sha)} · {r.branch}
                  </TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {r.duration_seconds != null ? formatDuration(r.duration_seconds) : "—"}
                  </TD>
                  <TD className="hidden text-right text-xs md:table-cell">
                    {formatRelative(r.queued_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New pipeline"
        description="Define the pipeline configuration; stages can be edited after creation."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createPipeline.isPending}
              disabled={!form.repository_id || form.name.trim().length < 2}
              onClick={() =>
                createPipeline.mutate({
                  name: form.name,
                  branch: form.branch,
                  repository_id: Number(form.repository_id),
                  triggers: [form.triggers],
                  stages: DEFAULT_STAGES,
                })
              }
            >
              Create pipeline
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. api-service-deploy"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Branch" required>
              <Input
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
              />
            </Field>
            <Field label="Trigger event">
              <select
                className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink"
                value={form.triggers}
                onChange={(e) => setForm({ ...form, triggers: e.target.value })}
              >
                <option value="push">push</option>
                <option value="pull_request">pull_request</option>
                <option value="manual">manual</option>
                <option value="schedule">schedule</option>
              </select>
            </Field>
          </div>
          <Field label="Repository" required hint="The backend requires a repository for each pipeline.">
            <select
              className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink"
              value={form.repository_id}
              onChange={(e) => setForm({ ...form, repository_id: e.target.value })}
            >
              <option value="">Select a repository</option>
              {repos?.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="rounded-lg border border-line bg-surface-3 p-3 text-xs leading-relaxed text-ink-faint">
            Default stages added on creation: <span className="text-ink-muted">checkout → install →
            build → test → lint → package → deploy → health check</span>. Each stage runs in an
            isolated job with a configurable timeout.
          </div>
        </div>
      </Modal>

      {/* Trigger run modal */}
      <Modal
        open={Boolean(runTarget)}
        onClose={() => setRunTarget(null)}
        title={`Run “${runTarget?.name ?? ""}”`}
        description="The run executes all enabled stages sequentially."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={triggerRun.isPending}
              onClick={() =>
                runTarget &&
                triggerRun.mutate({
                  id: runTarget.id,
                  body: {
                    commit_sha: runCommit || undefined,
                    branch: runTarget.branch,
                    triggered_by: "manual",
                  },
                })
              }
            >
              <Play className="mr-1.5 h-3.5 w-3.5" /> Start run
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Commit SHA" hint={`Leave empty to use the latest commit on ${runTarget?.branch}.`}>
            <Input
              value={runCommit}
              onChange={(e) => setRunCommit(e.target.value)}
              placeholder="e.g. a1b2c3d"
              className="font-mono"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Badge tone="slate">source: manual</Badge>
            <Badge tone="slate">
              <Clock className="mr-1 h-3 w-3" /> stage timeout 10m
            </Badge>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deletePipeline.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        danger
        confirmLabel="Delete pipeline"
        title="Delete pipeline?"
        message={
          <>
            <strong>{deleteTarget?.name}</strong> and its configuration will be removed. Historical
            runs are retained for audit purposes.
          </>
        }
      />
    </div>
  );
}
