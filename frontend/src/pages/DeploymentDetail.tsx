// @ts-nocheck
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Rocket,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  GitCommitHorizontal,
  ScrollText,
} from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type { DeploymentDetail } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { StatusBadge, Badge, SourceBadge } from "../components/ui/badge";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { ConfirmDialog, Modal } from "../components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatRelative, formatDuration, shortSha, cn } from "../lib/utils";

export function DeploymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const deploymentId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [confirmProd, setConfirmProd] = useState<string | null>(null);

  const { data: deployment, isLoading, error, refetch } = useApi<DeploymentDetail>(
    Number.isFinite(deploymentId) ? `/deployments/${deploymentId}` : null,
    { refetchInterval: 10_000 },
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["api"] });

  const rollback = useApiMutation<string, unknown>(
    (version) =>
      apiFetch(`/deployments/${deploymentId}/rollback`, {
        method: "POST",
        body: { version },
      }),
    {
      successMessage: (v) => `Rollback to v${v} initiated`,
      onSuccess: () => {
        setRollbackOpen(false);
        setConfirmProd(null);
        invalidate();
        refetch();
      },
    },
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Loading deployment…" />
      </div>
    );
  }

  if (error || !deployment) {
    return (
      <div className="space-y-4">
        <BackButton onClick={() => navigate("/deployments")} />
        <ErrorState message={error?.message ?? "Deployment not found"} onRetry={refetch} />
      </div>
    );
  }

  const isProduction = deployment.environment === "production";

  const requestRollback = () => {
    if (isProduction) {
      setConfirmProd(rollbackVersion || "previous");
    } else {
      rollback.mutate(rollbackVersion);
    }
  };

  return (
    <div className="space-y-5">
      <BackButton onClick={() => navigate("/deployments")} />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <Rocket className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold text-ink sm:text-2xl">
                {deployment.application_name}
              </h1>
              <StatusBadge status={deployment.status} />
              <SourceBadge source={deployment.source} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-faint">
              <Badge tone={isProduction ? "red" : deployment.environment === "staging" ? "amber" : "slate"}>
                {deployment.environment}
              </Badge>
              <Badge tone="violet">v{deployment.version}</Badge>
              {deployment.commit_sha && (
                <span className="flex items-center gap-1 font-mono text-xs">
                  <GitCommitHorizontal className="h-3.5 w-3.5" />
                  {shortSha(deployment.commit_sha)}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {deployment.rollback_available && deployment.status === "succeeded" && (
            <Button variant="secondary" onClick={() => setRollbackOpen(true)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Rollback
            </Button>
          )}
        </div>
      </div>

      {/* Facts grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Fact label="Initiated by" value={deployment.deployed_by_name ?? "system"} />
        <Fact
          label="Started"
          value={deployment.started_at ? formatRelative(deployment.started_at) : "—"}
        />
        <Fact
          label="Duration"
          value={deployment.duration_s != null ? formatDuration(deployment.duration_s) : "—"}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <Fact
          label="Health check"
          value={deployment.health_check_status ?? "not run"}
          status={
            deployment.health_check_status === "passing"
              ? "ok"
              : deployment.health_check_status === "failing"
                ? "critical"
                : "muted"
          }
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
      </div>

      {deployment.notes && (
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Notes</p>
          <p className="mt-1.5 text-sm text-ink-muted">{deployment.notes}</p>
        </Card>
      )}

      {deployment.rollback_of && (
        <Card className="border-violet-500/40 p-4">
          <p className="flex items-center gap-2 text-sm text-violet-300">
            <RotateCcw className="h-4 w-4" />
            This deployment is a rollback of deployment #{deployment.rollback_of}.
          </p>
        </Card>
      )}

      {/* Logs */}
      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ScrollText className="h-4 w-4 text-ink-faint" /> Deployment logs
            </h2>
            <p className="text-xs text-ink-faint">
              Structured, secret-redacted log output from the deploy job
            </p>
          </div>
          <Badge tone="slate">{deployment.logs.length} lines</Badge>
        </div>
        {deployment.logs.length === 0 ? (
          <EmptyState
            compact
            title="No logs captured"
            description="Log output appears here once the deployment job runs."
          />
        ) : (
          <div className="scroll-thin max-h-[480px] overflow-y-auto bg-[#0a0f1a] px-4 py-3 font-mono text-[11px] leading-relaxed">
            {deployment.logs.map((line, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-slate-600">{line.ts.slice(11, 19)}</span>
                <span
                  className={cn(
                    "w-14 shrink-0 uppercase",
                    line.level === "error"
                      ? "text-red-400"
                      : line.level === "warning"
                        ? "text-amber-400"
                        : "text-cyan-600",
                  )}
                >
                  {line.level}
                </span>
                <span className="text-slate-300">{line.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Deployment facts table */}
      <Card>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Deployment record</h2>
        </div>
        <Table>
          <THead>
            <TH>Property</TH>
            <TH>Value</TH>
          </THead>
          <TBody>
            <TR>
              <TD className="font-medium text-ink">Deployment ID</TD>
              <TD>#{deployment.id}</TD>
            </TR>
            <TR>
              <TD className="font-medium text-ink">Application</TD>
              <TD>{deployment.application_name}</TD>
            </TR>
            <TR>
              <TD className="font-medium text-ink">Environment</TD>
              <TD className="capitalize">{deployment.environment}</TD>
            </TR>
            <TR>
              <TD className="font-medium text-ink">Version</TD>
              <TD className="font-mono">{deployment.version}</TD>
            </TR>
            <TR>
              <TD className="font-medium text-ink">Commit</TD>
              <TD className="font-mono">{deployment.commit_sha ?? "—"}</TD>
            </TR>
            <TR>
              <TD className="font-medium text-ink">Finished</TD>
              <TD>
                {deployment.finished_at ? formatRelative(deployment.finished_at) : "still running"}
              </TD>
            </TR>
            <TR>
              <TD className="font-medium text-ink">Created</TD>
              <TD>{formatRelative(deployment.created_at)}</TD>
            </TR>
          </TBody>
        </Table>
      </Card>

      {/* Rollback modal */}
      <Modal
        open={rollbackOpen}
        onClose={() => setRollbackOpen(false)}
        title="Rollback deployment"
        description={
          isProduction
            ? "Production rollback requires explicit confirmation."
            : `Roll ${deployment.environment} back to a previous version.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setRollbackOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={isProduction ? "danger" : "primary"}
              loading={rollback.isPending}
              onClick={requestRollback}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Rollback
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Current version <span className="font-mono text-ink">v{deployment.version}</span> will be
            replaced. The rollback is recorded in the audit log.
          </p>
          <label className="block text-xs font-medium text-ink-muted">
            Target version (leave empty for the previous successful version)
          </label>
          <input
            className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 font-mono text-sm text-ink"
            value={rollbackVersion}
            onChange={(e) => setRollbackVersion(e.target.value)}
            placeholder="e.g. 1.4.2"
          />
          {deployment.health_check_status === "failing" && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <XCircle className="mr-1 inline h-3.5 w-3.5" />
              The latest health check is failing — rolling back is recommended.
            </p>
          )}
        </div>
      </Modal>

      {/* Production confirmation */}
      <ConfirmDialog
        open={Boolean(confirmProd)}
        onClose={() => setConfirmProd(null)}
        onConfirm={() => rollback.mutate(rollbackVersion)}
        loading={rollback.isPending}
        danger
        confirmLabel="Yes, rollback production"
        title="Confirm PRODUCTION rollback?"
        message={
          <>
            You are about to roll back{" "}
            <strong className="text-red-300">
              {deployment.application_name} in production
            </strong>{" "}
            {rollbackVersion ? `to v${rollbackVersion}` : "to the previous version"}. This affects
            live traffic and cannot be undone automatically.
          </>
        }
      />
    </div>
  );
}

function Fact({
  label,
  value,
  icon,
  status,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  status?: "ok" | "critical" | "muted";
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p
        className={cn(
          "mt-1.5 flex items-center gap-1.5 text-sm font-semibold",
          status === "ok" && "text-emerald-400",
          status === "critical" && "text-red-400",
          (!status || status === "muted") && "text-ink",
        )}
      >
        {icon}
        {value}
      </p>
    </Card>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded text-sm text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      <ArrowLeft className="h-4 w-4" /> All deployments
    </button>
  );
}
