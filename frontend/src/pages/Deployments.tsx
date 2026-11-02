// @ts-nocheck
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Rocket, Search, Filter } from "lucide-react";
import { useApi } from "../lib/hooks";
import type { DeploymentListResponse } from "../types";
import { Card } from "../components/ui/card";
import { Input, Select } from "../components/ui/input";
import { StatusBadge, Badge, SourceBadge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { Tabs } from "../components/ui/tabs";
import { formatRelative, formatDuration, shortSha } from "../lib/utils";
import { TimeRangePicker, type RangeKey } from "../components/TimeRangePicker";

const RANGE_HOURS: Record<RangeKey, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };

export function DeploymentsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeKey>("7d");
  const [status, setStatus] = useState("");
  const [env, setEnv] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (env) params.set("environment", env);
  params.set("hours", String(RANGE_HOURS[range]));
  params.set("limit", "100");

  const { data, isLoading, error, refetch } = useApi<DeploymentListResponse>(
    `/deployments?${params}`,
    { refetchInterval: 20_000 },
  );

  const counts = data?.counts ?? {};
  const items = (data?.items ?? []).filter((d) =>
    search
      ? d.application_name.toLowerCase().includes(search.toLowerCase()) ||
        d.version.toLowerCase().includes(search.toLowerCase()) ||
        (d.commit_sha ?? "").includes(search)
      : true,
  );

  const tabs = [
    { id: "", label: "All", count: data?.total },
    { id: "succeeded", label: "Succeeded", count: counts.succeeded },
    { id: "failed", label: "Failed", count: counts.failed },
    { id: "in_progress", label: "In progress", count: counts.in_progress },
    { id: "rolled_back", label: "Rolled back", count: counts.rolled_back },
    { id: "pending", label: "Pending", count: counts.pending },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Deployments</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Releases across development, staging and production with health checks and rollback
            support
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && <SourceBadge source={data.source} />}
          <TimeRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <Tabs tabs={tabs} active={status} onChange={setStatus} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            placeholder="Search app, version or commit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          aria-label="Filter by environment"
          className="w-auto"
        >
          <option value="">All environments</option>
          <option value="development">development</option>
          <option value="staging">staging</option>
          <option value="production">production</option>
        </Select>
        <span className="flex items-center gap-1.5 text-xs text-ink-faint">
          <Filter className="h-3.5 w-3.5" />
          {items.length} shown
        </span>
      </div>

      <Card>
        {error ? (
          <ErrorState message={error.message} onRetry={refetch} />
        ) : isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No deployments found"
            description="Trigger a pipeline run with a deploy stage to create deployments. Adjust the time range or filters to see more history."
            icon={<Rocket className="h-5 w-5" />}
          />
        ) : (
          <Table>
            <THead>
              <TH>Application</TH>
              <TH className="hidden sm:table-cell">Version</TH>
              <TH>Environment</TH>
              <TH>Status</TH>
              <TH className="hidden lg:table-cell">Initiator</TH>
              <TH className="text-right">Duration</TH>
              <TH className="hidden md:table-cell text-right">Started</TH>
            </THead>
            <TBody>
              {items.map((d) => (
                <TR key={d.id} onClick={() => navigate(`/deployments/${d.id}`)}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-300">
                        <Rocket className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-ink">{d.application_name}</p>
                        <p className="font-mono text-[11px] text-ink-faint">
                          {d.commit_sha ? shortSha(d.commit_sha) : "—"}
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <Badge tone="violet">v{d.version}</Badge>
                  </TD>
                  <TD className="capitalize">
                    <Badge tone={d.environment === "production" ? "red" : d.environment === "staging" ? "amber" : "slate"}>
                      {d.environment}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={d.status} />
                      {d.health_check_status && (
                        <span className="text-[10px] text-ink-faint">health: {d.health_check_status}</span>
                      )}
                    </div>
                  </TD>
                  <TD className="hidden lg:table-cell">{d.deployed_by_name ?? "system"}</TD>
                  <TD className="text-right tabular-nums">
                    {d.duration_s != null ? formatDuration(d.duration_s) : "—"}
                  </TD>
                  <TD className="hidden whitespace-nowrap text-right text-xs md:table-cell">
                    {formatRelative(d.started_at ?? d.created_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <p className="text-center text-[11px] text-ink-faint">
        Production deployments and rollbacks require explicit confirmation and are recorded in the
        audit log.
      </p>
    </div>
  );
}
