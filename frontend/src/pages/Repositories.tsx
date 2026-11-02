import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  GitFork,
  Plus,
  GitBranch,
  GitCommitHorizontal,
  Webhook,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type { Repository, RepositoryDetail } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Field } from "../components/ui/input";
import { Modal, ConfirmDialog } from "../components/ui/dialog";
import { StatusBadge, Badge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton, Spinner } from "../components/ui/states";
import { formatRelative, shortSha, cn } from "../lib/utils";

export function RepositoriesPage() {
  const queryClient = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Repository | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    default_branch: "main",
    clone_url: "",
  });

  const { data, isLoading, error, refetch } = useApi<Repository[]>(
    "/repositories",
    { refetchInterval: 30_000 },
  );

  const connectRepo = useApiMutation<object, Repository>(
    (body) => apiFetch("/repositories", { method: "POST", body }),
    {
      successMessage: (r) => `Repository ${r.full_name} connected`,
      onSuccess: () => {
        setConnectOpen(false);
        setForm({ full_name: "", default_branch: "main", clone_url: "" });
        queryClient.invalidateQueries({ queryKey: ["api"] });
      },
    },
  );

  const syncRepo = useApiMutation<number, unknown>(
    (id) => apiFetch(`/repositories/${id}/sync`, { method: "POST" }),
    {
      successMessage: "Repository synced",
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api"] }),
    },
  );

  const deleteRepo = useApiMutation<number, unknown>(
    (id) => apiFetch(`/repositories/${id}`, { method: "DELETE" }),
    {
      successMessage: "Repository disconnected",
      onSuccess: () => {
        setDeleteTarget(null);
        queryClient.invalidateQueries({ queryKey: ["api"] });
      },
    },
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Repositories</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Git connections, branches, recent commits and webhook status
          </p>
        </div>
        <Button variant="primary" onClick={() => setConnectOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Connect repository
        </Button>
      </div>

      {error ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : isLoading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState
            title="No repositories connected"
            description="Connect a repository to trigger pipelines from push and pull_request events. OAuth or a personal access token with repo scope is required."
            action={
              <Button variant="primary" onClick={() => setConnectOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Connect a repository
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((repo) => {
            const status = repo.connection_status;
            return (
              <Card key={repo.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/15 text-slate-300">
                      <GitFork className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{repo.name}</p>
                      <p className="truncate text-[11px] text-ink-faint">{repo.full_name}</p>
                    </div>
                  </div>
                  <StatusBadge status={status} label={status.replace(/_/g, " ")} />
                </div>

                <div className="mt-3.5 flex flex-wrap gap-1.5">
                  <Badge tone="cyan">
                    <GitBranch className="mr-1 h-3 w-3" />
                    {repo.default_branch}
                  </Badge>
                  <Badge tone={repo.webhook_configured ? "green" : "amber"}>
                    <Webhook className="mr-1 h-3 w-3" />
                    {repo.webhook_configured ? "webhook ok" : "no webhook"}
                  </Badge>
                </div>

                <p className="mt-3 text-[11px] text-ink-faint">
                  {repo.last_event_at
                    ? `last event ${formatRelative(repo.last_event_at)}`
                    : repo.status_detail}
                  {repo.clone_url && (
                    <>
                      {" · "}
                      <a
                        href={repo.clone_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-accent hover:underline"
                      >
                        open <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </p>

                <div className="mt-4 flex gap-2 border-t border-line pt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => setDetailId(repo.id)}
                  >
                    Details
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => syncRepo.mutate(repo.id)}
                    title="Sync branches and commits"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", syncRepo.isPending && "animate-spin")} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Disconnect"
                    onClick={() => setDeleteTarget(repo)}
                  >
                    ✕
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Connect modal */}
      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect a repository"
        description="Register a repository. Configure GitHub credentials in the backend environment."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={connectRepo.isPending}
              onClick={() =>
                connectRepo.mutate({
                  full_name: form.full_name,
                  default_branch: form.default_branch,
                  clone_url: form.clone_url || undefined,
                })
              }
            >
              Connect
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Default branch">
              <Input
                value={form.default_branch}
                onChange={(e) => setForm({ ...form, default_branch: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Repository (owner/name)" required>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="e.g. acme/payments-api"
              className="font-mono"
            />
          </Field>
          <Field label="Clone URL" hint="Optional; defaults to the GitHub clone URL.">
            <Input
              value={form.clone_url}
              onChange={(e) => setForm({ ...form, clone_url: e.target.value })}
              placeholder="https://github.com/acme/payments-api.git"
              className="font-mono"
            />
          </Field>
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs leading-relaxed text-ink-muted">
            <p className="font-semibold text-cyan-300">Webhook setup</p>
            <p className="mt-1">
              After connecting, point your Git provider&apos;s webhook at{" "}
              <span className="font-mono">POST /api/v1/repositories/webhook/github</span> with content type{" "}
              <span className="font-mono">application/json</span> and a secret. Signatures are
              validated with HMAC-SHA256; duplicate and out-of-order deliveries are handled safely.
            </p>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      {detailId !== null && (
        <RepositoryDetailModal id={detailId} onClose={() => setDetailId(null)} />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteRepo.mutate(deleteTarget.id);
        }}
        loading={deleteRepo.isPending}
        danger
        confirmLabel="Disconnect"
        title="Disconnect repository?"
        message={
          <>
            <strong>{deleteTarget?.full_name}</strong> will be disconnected. Pipelines referencing
            it lose webhook triggers; existing runs are retained.
          </>
        }
      />
    </div>
  );
}

function RepositoryDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApi<RepositoryDetail>(`/repositories/${id}`);
  const repo = data?.repository;

  return (
    <Modal
      open
      onClose={onClose}
      title={repo ? repo.full_name : "Repository"}
      description="Branches, recent commits and linked pipelines"
      width="max-w-2xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner label="Loading repository…" />
        </div>
      ) : error ? (
        <ErrorState message={error.message} compact />
      ) : data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone="cyan">
              <GitBranch className="mr-1 h-3 w-3" />
              {data.repository.default_branch}
            </Badge>
            <StatusBadge status={data.repository.connection_status} />
            <Badge tone={data.repository.webhook_configured ? "green" : "amber"}>
              {data.repository.webhook_configured ? "webhook configured" : "webhook missing"}
            </Badge>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Branches ({data.branches.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {data.branches.slice(0, 12).map((b) => (
                <Badge key={b.name} tone={b.protected ? "green" : "slate"}>
                  <GitBranch className="mr-1 h-3 w-3" />
                  {b.name}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Recent commits
            </h3>
            <ul className="space-y-2">
              {data.commits.slice(0, 8).map((c) => (
                <li key={c.sha} className="flex items-start gap-2.5 text-xs">
                  <GitCommitHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  <div className="min-w-0">
                    <p className="truncate text-ink">{c.message}</p>
                    <p className="text-ink-faint">
                      <span className="font-mono">{shortSha(c.sha)}</span> · {c.author} ·{" "}
                      {formatRelative(c.when)}
                    </p>
                  </div>
                </li>
              ))}
              {data.commits.length === 0 && (
                <li className="text-xs text-ink-faint">No commits synced yet.</li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Linked pipelines
            </h3>
            {data.pipelines.length === 0 ? (
              <p className="text-xs text-ink-faint">No pipelines reference this repository yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.pipelines.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        onClose();
                        navigate(`/pipelines/${p.id}`);
                      }}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs hover:bg-surface-3"
                    >
                      <span className="text-ink">{p.name}</span>
                      <span className="text-ink-faint">
                        {p.branch} · {p.environment}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(data.setup_guidance?.length ?? 0) > 0 && (
            <div className="space-y-2">
              {data.setup_guidance?.map((step) => (
                <div key={step} className="rounded-lg border border-line bg-surface-3 p-3">
                  <p className="text-xs leading-relaxed text-ink-faint">{step}</p>
                </div>
              ))}
            </div>
          )}
          {data.webhook && (
            <p className="break-all text-xs text-ink-faint">
              Webhook URL: <span className="font-mono">{data.webhook.url}</span>
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
