import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type Tone =
  | "gray"
  | "green"
  | "amber"
  | "red"
  | "blue"
  | "cyan"
  | "violet"
  | "slate";

const tones: Record<Tone, string> = {
  gray: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  slate: "bg-surface-4 text-ink-muted border-line",
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  red: "bg-red-500/15 text-red-300 border-red-500/30",
  blue: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

export function Badge({
  children,
  tone = "gray",
  className,
  dot,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span
      className={cn("badge border", tones[tone], className)}
      title={title}
      data-testid="badge"
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot"
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/** Map common operational states to badge tones. */
export const statusTone: Record<string, Tone> = {
  // servers
  healthy: "green",
  warning: "amber",
  critical: "red",
  offline: "gray",
  online: "green",
  stale: "amber",
  // pipeline runs / stages
  queued: "slate",
  running: "blue",
  succeeded: "green",
  failed: "red",
  cancelled: "gray",
  // deployments
  pending: "amber",
  rolled_back: "violet",
  // applications
  degraded: "amber",
  down: "red",
  unknown: "gray",
  // alerts
  open: "red",
  acknowledged: "amber",
  muted: "slate",
  resolved: "green",
  // repositories
  connected: "green",
  missing_credentials: "amber",
  error: "red",
  // data source
  demo: "violet",
  live: "cyan",
};

export function StatusBadge({
  status,
  label,
  pulse,
}: {
  status: string;
  label?: string;
  pulse?: boolean;
}) {
  const tone = statusTone[status] ?? "gray";
  return (
    <Badge tone={tone} dot={pulse ?? status === "running"}>
      {(label ?? status).replace(/_/g, " ")}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string | undefined }) {
  if (!source) return null;
  const isDemo = source === "demo";
  return (
    <Badge tone={isDemo ? "violet" : "cyan"} title={isDemo
      ? "Simulated sample data — not live production telemetry"
      : "Live data from a connected agent or integration"}
    >
      {isDemo ? "demo" : "live"}
    </Badge>
  );
}
