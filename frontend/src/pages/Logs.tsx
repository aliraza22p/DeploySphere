// @ts-nocheck
import { useState } from "react";
import { ScrollText, Info, Download, RefreshCw } from "lucide-react";
import { useApi } from "../lib/hooks";
import type { Page as PageT } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Select } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { LogViewer, type LogFilters } from "../components/LogViewer";
import { TimeRangePicker, type RangeKey } from "../components/TimeRangePicker";

const RANGE_HOURS: Record<RangeKey, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };

const SOURCES = [
  "pipeline",
  "build",
  "deploy",
  "agent",
  "server",
  "application",
  "auth",
  "system",
] as const;

const SEVERITIES = ["debug", "info", "warning", "error", "critical"] as const;

export function LogsPage() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [severity, setSeverity] = useState("");
  const [serverId, setServerId] = useState("");
  const [streaming, setStreaming] = useState(true);

  const { data: servers } = useApi<PageT<{ id: number; name: string }>>("/servers?limit=100");

  const filters: LogFilters = {
    hours: RANGE_HOURS[range],
    limit: 300,
    ...(search ? { q: search } : {}),
    ...(source ? { source } : {}),
    ...(severity ? { severity } : {}),
    ...(serverId ? { server_id: Number(serverId) } : {}),
  };

  const clearFilters = () => {
    setSearch("");
    setSource("");
    setSeverity("");
    setServerId("");
    setRange("24h");
  };

  const hasFilters = Boolean(search || source || severity || serverId || range !== "24h");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Log Explorer</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-ink-faint">
            <ScrollText className="h-3.5 w-3.5" />
            Pipeline, build, deployment, agent, server and application logs — searchable,
            filterable and streamable
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={streaming ? "cyan" : "slate"}>{streaming ? "live tail on" : "live tail off"}</Badge>
          <TimeRangePicker value={range} onChange={setRange} />
          <Button variant="secondary" size="sm" onClick={() => setStreaming((s) => !s)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {streaming ? "Pause" : "Resume"}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="relative xl:col-span-2">
            <Input
              placeholder="Search message text…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-3"
            />
          </div>
          <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
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
          <Button variant="ghost" onClick={clearFilters} disabled={!hasFilters}>
            Clear filters
          </Button>
        </div>
      </Card>

      {/* Viewer */}
      <Card className="overflow-hidden">
        <LogViewer
          filters={filters}
          autoRefresh={streaming}
          maxHeight="65vh"
          emptyTitle="No log entries match"
          emptyDescription="Adjust the time range, source, severity or search text. New matching entries stream in live while the tail is active."
        />
      </Card>

      {/* Help */}
      <Card className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Info className="h-4 w-4 text-accent" /> About log processing
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-faint">
          <li>
            · Secrets are redacted with <span className="font-mono text-ink-muted">***</span> before
            storage and display — API keys, tokens and passwords never appear in logs.
          </li>
          <li>
            · Historical entries are paginated (<span className="font-mono">limit/offset</span>);
            new entries matching your filters are appended live over WebSocket.
          </li>
          <li>
            · <Download className="inline h-3 w-3" /> Export downloads the filtered set as plain
            text with timestamps and severity preserved.
          </li>
        </ul>
      </Card>
    </div>
  );
}
