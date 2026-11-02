import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ArrowDown } from "lucide-react";
import type { LogOut, LogMessage, Page } from "../types";
import { tokens } from "../lib/api";
import { useApi } from "../lib/hooks";
import { formatTimestamp, cn } from "../lib/utils";
import { useServerEvent } from "../lib/live-status";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, Spinner } from "./ui/states";
import { Badge } from "./ui/badge";

/**
 * Log filters — maps onto GET /api/v1/logs query parameters.
 * `hours` is converted to an ISO `from` timestamp.
 */
export interface LogFilters {
  q?: string;
  search?: string;
  source?: string;
  server_id?: number;
  pipeline_run_id?: number;
  deployment_id?: number;
  severity?: string;
  data_source?: string;
  hours?: number;
  page?: number;
  page_size?: number;
  limit?: number;
  from?: string;
  to?: string;
  [key: string]: any;
}

function buildQuery(filters: LogFilters): string {
  const params = new URLSearchParams();
  const f = { ...filters };
  if (f.search && !f.q) f.q = f.search;
  if (f.limit && !f.page_size) f.page_size = f.limit;
  Object.entries(f).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (key === "hours") {
      params.set("from", new Date(Date.now() - (value as number) * 3_600_000).toISOString());
      return;
    }
    if (key === "search" || key === "limit") return;
    params.set(key, String(value));
  });
  return `/logs?${params.toString()}`;
}

const severityColor: Record<string, string> = {
  debug: "text-slate-500",
  info: "text-cyan-600 dark:text-cyan-400",
  warning: "text-amber-500",
  error: "text-red-500",
  critical: "text-red-600 dark:text-red-400",
};

/** Client-side key for streamed entries that arrive without an id. */
let wsSeq = 0;

function fromStream(msg: LogMessage): LogOut {
  return {
    id: msg.id ?? -(++wsSeq),
    ts: msg.ts,
    source: msg.source,
    severity: msg.severity,
    message: msg.message,
    server_id: msg.server_id ?? null,
    pipeline_run_id: msg.pipeline_run_id ?? null,
    deployment_id: msg.deployment_id ?? null,
    trace_id: msg.trace_id ?? "",
    source_data: msg.source_data,
  };
}

function matchesFilters(record: LogOut, filters: LogFilters): boolean {
  if (filters.source && record.source !== filters.source) return false;
  if (filters.server_id && record.server_id !== filters.server_id) return false;
  if (filters.pipeline_run_id && record.pipeline_run_id !== filters.pipeline_run_id) return false;
  if (filters.deployment_id && record.deployment_id !== filters.deployment_id) return false;
  if (filters.severity && record.severity !== filters.severity) return false;
  if (filters.data_source && record.source_data !== filters.data_source) return false;
  if (filters.q && !record.message.toLowerCase().includes(filters.q.toLowerCase())) return false;
  return true;
}

export function LogViewer({
  filters,
  autoRefresh = true,
  maxHeight = "60vh",
  emptyTitle = "No log entries",
  emptyDescription = "No log records match the current filters.",
}: {
  filters: LogFilters;
  autoRefresh?: boolean;
  maxHeight?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const queryKey = buildQuery(filters);
  const { data, isLoading, error, refetch } = useApi<Page<LogOut>>(queryKey, {
    refetchInterval: autoRefresh ? 10_000 : undefined,
  });
  const [streamLogs, setStreamLogs] = useState<LogOut[]>([]);
  const [following, setFollowing] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Live stream: append matching entries pushed over WebSocket (`log.created`).
  useServerEvent<LogMessage>("log.created", (msg) => {
    if (!autoRefresh) return;
    const record = fromStream(msg);
    setStreamLogs((prev) => {
      if (!matchesFilters(record, filters)) return prev;
      const next = [...prev, record];
      return next.length > 500 ? next.slice(-500) : next;
    });
  });

  // Reset the streamed buffer whenever the server-side query changes.
  useEffect(() => {
    setStreamLogs([]);
  }, [queryKey]);

  const logs = useMemo(() => {
    const items = data?.items ?? [];
    // Newest first: server returns ascending ts, so reverse; streamed entries
    // sit on top with negative ids deduped against the page.
    const page = [...items].reverse();
    const streamed = [...streamLogs].reverse();
    const ids = new Set(streamed.map((l) => l.id));
    return [...streamed, ...page.filter((l) => !ids.has(l.id))];
  }, [data, streamLogs]);

  // Auto-scroll while following (newest entries render first → top).
  useEffect(() => {
    if (!following || !containerRef.current) return;
    containerRef.current.scrollTop = 0;
  }, [logs.length, following]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setFollowing(el.scrollTop < 40);
  };

  const exportLogs = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        if (key === "hours") {
          params.set("from", new Date(Date.now() - (value as number) * 3_600_000).toISOString());
          return;
        }
        if (key === "page" || key === "page_size") return;
        params.set(key, String(value));
      });
      params.set("limit", "5000");
      const res = await fetch(`/api/v1/logs/export?${params}`, {
        headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deploysphere-logs-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Log export failed");
    }
  };

  if (error) {
    return <ErrorState message={error.message} onRetry={refetch} />;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          <Spinner className="h-3 w-3" />
          <span>
            {logs.length} entries{autoRefresh && " · live tail"}
          </span>
          {streamLogs.length > 0 && <Badge tone="cyan">{streamLogs.length} streamed</Badge>}
          {data && <Badge tone="slate">{data.total} total</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFollowing((f) => !f)}
            title="Toggle auto-scroll"
          >
            <ArrowDown className={cn("h-3.5 w-3.5", following && "text-accent")} />
            <span className="ml-1 hidden sm:inline">{following ? "Following" : "Paused"}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={exportLogs} title="Download filtered logs (CSV)">
            <Download className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={onScroll}
        style={{ maxHeight }}
        className="scroll-thin overflow-y-auto bg-[#0a0f1a] px-3 py-2 font-mono text-[11px] leading-relaxed"
        role="log"
        aria-label="Log entries"
      >
        {isLoading && logs.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner label="Loading logs…" />
          </div>
        ) : logs.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} compact />
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 py-0.5 hover:bg-white/[0.03]">
              <span className="shrink-0 text-slate-600 tabular-nums">
                {formatTimestamp(new Date(log.ts).getTime())}
              </span>
              <span
                className={cn(
                  "w-14 shrink-0 uppercase",
                  severityColor[log.severity] ?? "text-slate-400",
                )}
              >
                {log.severity}
              </span>
              <span className="w-24 shrink-0 truncate text-violet-400/80">{log.source}</span>
              <span className="min-w-0 flex-1 break-words text-slate-300">{log.message}</span>
              {log.source_data === "demo" && (
                <span className="shrink-0 self-center rounded border border-violet-500/40 px-1 text-[9px] uppercase text-violet-300">
                  demo
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function useLogFilters() {
  const [filters, setFilters] = useState<LogFilters>({ hours: 24, page_size: 200 });
  const update = (patch: Partial<LogFilters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const clear = () => setFilters({ hours: 24, page_size: 200 });
  return { filters, update, clear, setFilters };
}
