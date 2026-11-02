// @ts-nocheck
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, Play, RotateCcw, Clock, ScrollText } from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type { Pipeline, PipelineRunDetail, RunListResponse } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { Modal } from "../components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatRelative, formatDuration, shortSha, cn } from "../lib/utils";
import { Tabs } from "../components/ui/tabs";

const stageKindIcon: Record<string, string> = {
  checkout: "📦",
  install: "📥",
  build: "🔨",
  test: "🧪",
  lint: "✨",
  package: "🎁",
  deploy: "🚀",
  health: "❤️",
};

export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pipelineId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("runs");
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [commit, setCommit] = useState("");

  const { data: pipeline, isLoading, error, refetch } = useApi<Pipeline>(
    Number.isFinite(pipelineId) ? `/pipelines/${pipelineId}` : null,
  );
  const { data: runs } = useApi<RunListResponse>(
    Number.isFinite(pipelineId)
      ? `/pipeline-runs?page_size=50&pipeline_id=${pipelineId}`
      : null,
    { refetchInterval: 10_000 },
  );

  // Auto-select the newest run when not chosen manually.
  const activeRunId = selectedRun ?? runs?.items[0]?.id ?? null;
  const { data: runDetail, refetch: refetchRun } = useApi<PipelineRunDetail>(
    activeRunId ? `/pipeline-runs/${activeRunId}` : null,
    { refetchInterval: 5_000 },
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["api"] });

  const triggerRun = useApiMutation<object, { id: number }>(
    (body) => apiFetch(`/pipelines/${pipelineId}/run`, { method: "POST", body }),
    {
      successMessage: "Pipeline run triggered",
      onSuccess: () => {
        setRunOpen(false);
        setSelectedRun(null);
        invalidate();
      },
    },
  );

  const retryStage = useApiMutation<{ runId: number; stageId: number }, unknown>(
    ({ runId, stageId }) =>
      apiFetch(`/pipeline-runs/${runId}/stages/${stageId}/retry`, {
        method: "POST",
      }),
    {
      successMessage: "Stage retry scheduled",
      onSuccess: () => {
        invalidate();
        refetchRun();
      },
    },
  );

  const toggleEnabled = useApiMutation<boolean, unknown>(
    (enabled) => apiFetch(`/pipelines/${pipelineId}`, { method: "PATCH", body: { enabled } }),
    { successMessage: "Pipeline updated", onSuccess: invalidate },
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Loading pipeline…" />
      </div>
    );
  }

  if (error || !pipeline) {
    return (
      <div className="space-y-4">
        <BackButton onClick={() => navigate("/pipelines")} />
        <ErrorState message={error?.message ?? "Pipeline not found"} onRetry={refetch} />
      </div>
    );
  }

  const runsList = runs?.items ?? [];
  const canRetry =
    runDetail &&
    (runDetail.status === "failed" || runDetail.status === "cancelled" || runDetail.status === "succeeded");

  return (
    <div className="space-y-5">
      <BackButton onClick={() => navigate("/pipelines")} />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-ink sm:text-2xl">{pipeline.name}</h1>
            <StatusBadge
              status={pipeline.enabled ? "healthy" : "offline"}
              label={pipeline.enabled ? "enabled" : "disabled"}
            />
          </div>
          <p className="mt-1 text-sm text-ink-faint">
            {pipeline.repository?.name ?? "No repository"} ·{" "}
            <Badge tone="cyan">
              <GitBranch className="mr-1 h-3 w-3" />
              {pipeline.branch}
            </Badge>{" "}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => toggleEnabled.mutate(!pipeline.enabled)}>
            {pipeline.enabled ? "Disable" : "Enable"}
          </Button>
          <Button variant="primary" onClick={() => setRunOpen(true)}>
            <Play className="mr-1.5 h-3.5 w-3.5" /> Run pipeline
          </Button>
        </div>
      </div>

      {/* Stage timeline */}
      <Card>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Stage configuration</h2>
          <p className="text-xs text-ink-faint">
            Stages execute sequentially in isolated jobs with a 10 minute timeout each.
          </p>
        </div>
        <div className="scroll-thin flex gap-3 overflow-x-auto px-5 py-4">
          {pipeline.stages.map((stage, idx) => (
            <div key={stage.key} className="flex items-center gap-3">
              <div className="min-w-36 rounded-lg border border-line bg-surface-3 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-base" aria-hidden>
                    {stageKindIcon[stage.key] ?? "⚙️"}
                  </span>
                  <p className="text-xs font-semibold text-ink">{stage.name}</p>
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-faint">
                  {stage.key} · {Math.round(stage.timeout_seconds / 60)}m timeout
                </p>
              </div>
              {idx < pipeline.stages.length - 1 && (
                <div className="h-px w-6 shrink-0 bg-line" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </Card>

      <Tabs
        tabs={[
          { id: "runs", label: "Runs", count: runsList.length },
          { id: "config", label: "Configuration" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "runs" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {/* Run list */}
          <Card className="xl:col-span-2">
            <div className="border-b border-line px-5 py-3.5">
              <h2 className="text-sm font-semibold text-ink">Run history</h2>
            </div>
            {runsList.length === 0 ? (
              <EmptyState
                compact
                title="No runs yet"
                description="Trigger the pipeline to see execution history."
                action={
                  <Button variant="primary" size="sm" onClick={() => setRunOpen(true)}>
                    <Play className="mr-1.5 h-3.5 w-3.5" /> Run now
                  </Button>
                }
              />
            ) : (
              <ul className="max-h-[540px] divide-y divide-line/70 overflow-y-auto">
                {runsList.map((run) => (
                  <li key={run.id}>
                    <button
                      onClick={() => setSelectedRun(run.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors",
                        run.id === activeRunId ? "bg-accent/10" : "hover:bg-surface-3",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium text-ink">
                          <span className="font-mono text-xs">{shortSha(run.commit_sha)}</span>
                          <span className="text-ink-faint">·</span>
                          <span className="text-xs text-ink-faint">{run.branch}</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-faint">
                          {run.triggered_by} · {formatRelative(run.queued_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={run.status} />
                        {run.duration_seconds != null && (
                          <span className="text-[10px] tabular-nums text-ink-faint">
                            {formatDuration(run.duration_seconds)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Run detail */}
          <Card className="xl:col-span-3">
            {!runDetail ? (
              <EmptyState
                compact
                title="Select a run"
                description="Choose a run from the history to inspect stage logs and timings."
                icon={<ScrollText className="h-5 w-5" />}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      Run #{runDetail.id}{" "}
                      <span className="ml-1 font-mono text-xs font-normal text-ink-faint">
                        {shortSha(runDetail.commit_sha)}
                      </span>
                    </h2>
                    <p className="text-xs text-ink-faint">
                      {runDetail.commit_message ?? "No commit message"} · by {runDetail.triggered_by}
                      {runDetail.artifact_version && (
                        <> · artifact <span className="font-mono">{runDetail.artifact_version}</span></>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={runDetail.status} />
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => triggerRun.mutate({ commit_sha: runDetail.commit_sha })}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Rerun
                      </Button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-line/70">
                  {(runDetail.stages ?? []).map((stage) => (
                    <div key={stage.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span aria-hidden>{stageKindIcon[stage.key] ?? "⚙️"}</span>
                          <p className="text-sm font-medium text-ink">{stage.name}</p>
                          <StatusBadge status={stage.status} />
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-ink-faint">
                          {stage.duration_seconds != null && (
                            <span className="flex items-center gap-1 tabular-nums">
                              <Clock className="h-3 w-3" />
                              {formatDuration(stage.duration_seconds)}
                            </span>
                          )}
                          {stage.started_at && (
                            <span>started {formatRelative(stage.started_at)}</span>
                          )}
                          {stage.status === "failed" &&
                            stage.key !== "deploy" &&
                            runDetail.status === "failed" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  retryStage.mutate({ runId: runDetail.id, stageId: stage.id })
                                }
                              >
                                <RotateCcw className="mr-1 h-3 w-3" /> Retry stage
                              </Button>
                            )}
                        </div>
                      </div>

                      {stage.log && (
                        <pre className="scroll-thin mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-[#0a0f1a] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                          {stage.log}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-semibold text-ink">Pipeline configuration</h2>
          </div>
          <Table>
            <THead>
              <TH>Property</TH>
              <TH>Value</TH>
            </THead>
            <TBody>
              <TR>
                <TD className="font-medium text-ink">Pipeline ID</TD>
                <TD>#{pipeline.id}</TD>
              </TR>
              <TR>
                <TD className="font-medium text-ink">Repository</TD>
                <TD>{pipeline.repository?.name ?? "Not connected"}</TD>
              </TR>
              <TR>
                <TD className="font-medium text-ink">Branch</TD>
                <TD>
                  <Badge tone="cyan">{pipeline.branch}</Badge>
                </TD>
              </TR>
              <TR>
                <TD className="font-medium text-ink">Trigger events</TD>
                <TD>
                  <div className="flex flex-wrap gap-1.5">
                    {pipeline.triggers.map((t) => (
                      <Badge key={t} tone="violet">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </TD>
              </TR>
              <TR>
                <TD className="font-medium text-ink">Stages</TD>
                <TD>{pipeline.stages.map((s) => s.name).join(" → ")}</TD>
              </TR>
              <TR>
                <TD className="font-medium text-ink">Created</TD>
                <TD>
                  {formatRelative(pipeline.created_at)}
                  {pipeline.created_by && <> by {pipeline.created_by}</>}
                </TD>
              </TR>
              <TR>
                <TD className="font-medium text-ink">Last updated</TD>
                <TD>{formatRelative(pipeline.updated_at)}</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      )}

      {/* Trigger modal */}
      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title={`Run “${pipeline.name}”`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={triggerRun.isPending}
              onClick={() =>
                triggerRun.mutate({
                  branch: pipeline.branch,
                  commit_sha: commit || undefined,
                  triggered_by: "manual",
                })
              }
            >
              <Play className="mr-1.5 h-3.5 w-3.5" /> Start run
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            All {pipeline.stages.length} stages will execute sequentially. Production deployments
            require explicit confirmation in the deployment flow.
          </p>
          <label className="block text-xs font-medium text-ink-muted">
            Commit SHA (optional — defaults to latest on {pipeline.branch})
          </label>
          <input
            className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 font-mono text-sm text-ink"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
            placeholder="a1b2c3d"
          />
        </div>
      </Modal>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 rounded"
    >
      <ArrowLeft className="h-4 w-4" /> All pipelines
    </button>
  );
}
