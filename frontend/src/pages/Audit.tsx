import { useState } from "react";
import { ClipboardList, Search, Shield } from "lucide-react";
import { useApi } from "../lib/hooks";
import type { AuditListResponse } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Select } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatRelative } from "../lib/utils";
import { TimeRangePicker, type RangeKey } from "../components/TimeRangePicker";

const RANGE_HOURS: Record<RangeKey, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };

const ACTIONS = [
  "",
  "login",
  "logout",
  "register",
  "pipeline.create",
  "pipeline.update",
  "pipeline.delete",
  "pipeline.run",
  "deployment.create",
  "deployment.rollback",
  "alert.acknowledge",
  "alert.resolve",
  "user.create",
  "user.update",
  "settings.update",
  "settings.reset_demo",
] as const;

export function AuditPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const params = new URLSearchParams();
  params.set("hours", String(RANGE_HOURS[range]));
  if (action) params.set("action", action);
  if (search.trim()) params.set("q", search.trim());
  params.set("page", String(page));
  params.set("page_size", String(pageSize));

  const { data, isLoading, error, refetch } = useApi<AuditListResponse>(
    `/audit?${params}`,
    { refetchInterval: 60_000 },
  );

  const items = data?.items ?? [];

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink sm:text-2xl">
            <ClipboardList className="h-5 w-5 text-accent" /> Audit Log
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            Immutable record of security-relevant actions — pipeline edits, production deployments,
            rollbacks, user changes and alert acknowledgements
          </p>
        </div>
        <TimeRangePicker value={range} onChange={(v) => { setRange(v); setPage(1); }} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            placeholder="Search actor, action or entity…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          aria-label="Filter by action"
          className="w-auto"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a || "All actions"}
            </option>
          ))}
        </Select>
        <span className="text-xs text-ink-faint">{total} events in range</span>
      </div>

      <Card>
        {error ? (
          <ErrorState message={error.message} onRetry={refetch} />
        ) : isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No audit events"
            description="Actions like pipeline edits, production deployments, rollbacks and user changes will appear here."
            icon={<Shield className="h-5 w-5" />}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TH>Time</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH className="hidden md:table-cell">Entity</TH>
                <TH className="hidden lg:table-cell">Details</TH>
                <TH className="hidden xl:table-cell text-right">IP</TH>
              </THead>
              <TBody>
                {items.map((event) => (
                  <TR key={event.id}>
                    <TD className="whitespace-nowrap text-xs">
                      {formatRelative(event.created_at)}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-4 text-[10px] font-bold text-ink-muted">
                          (event.actor_email || "?").slice(0, 1).toUpperCase()
                        </div>
                        <span className="text-sm text-ink">{event.actor_email || "system"}</span>
                      </div>
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          event.action.includes("delete") || event.action.includes("rollback")
                            ? "red"
                            : event.action.startsWith("login") || event.action.startsWith("user")
                              ? "violet"
                              : event.action.includes("deploy")
                                ? "cyan"
                                : "slate"
                        }
                      >
                        {event.action}
                      </Badge>
                    </TD>
                    <TD className="hidden md:table-cell text-xs">
                      {event.resource_type ? (
                        <>
                          {event.resource_type}
                          {event.resource_id && (
                            <span className="text-ink-faint"> #{event.resource_id}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="hidden max-w-72 truncate lg:table-cell text-xs text-ink-faint">
                      {event.detail || "—"}
                    </TD>
                    <TD className="hidden text-right font-mono text-xs xl:table-cell">
                      {event.ip_address ?? "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-3">
                <p className="text-xs text-ink-faint">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <p className="text-center text-[11px] text-ink-faint">
        Audit records are append-only and retained for the lifetime of the workspace.
      </p>
    </div>
  );
}
