import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, formatNumber } from "../lib/utils";
import { SourceBadge } from "./ui/badge";

export interface MetricCardProps {
  label: string;
  value: number | string;
  unit?: string;
  icon?: ReactNode;
  /** -1 / 0 / 1 → down / flat / up */
  trend?: -1 | 0 | 1 | null;
  sub?: string;
  status?: "healthy" | "warning" | "critical" | "muted" | "info" | "ok";
  source?: string;
  live?: boolean;
  onClick?: () => void;
}

const statusStyles: Record<NonNullable<MetricCardProps["status"]>, string> = {
  healthy: "text-emerald-400",
  ok: "text-emerald-400",
  warning: "text-amber-400",
  critical: "text-red-400",
  info: "text-cyan-400",
  muted: "text-ink-muted",
};

export function MetricCard({
  label,
  value,
  unit,
  icon,
  trend,
  sub,
  status = "muted",
  source,
  live,
  onClick,
}: MetricCardProps) {
  const trendIcon =
    trend === 1 ? (
      <TrendingUp className="h-3 w-3" />
    ) : trend === -1 ? (
      <TrendingDown className="h-3 w-3" />
    ) : trend === 0 ? (
      <Minus className="h-3 w-3" />
    ) : null;

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "card group relative w-full p-4 text-left transition-colors",
        onClick && "hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {label}
        </p>
        <div className="flex items-center gap-1.5">
          {live && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse-dot" title="Live" />}
          {source && <SourceBadge source={source} />}
        </div>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <p
          className={cn(
            "text-2xl font-bold tracking-tight tabular-nums",
            statusStyles[status],
          )}
        >
          {typeof value === "number" ? formatNumber(value) : value}
          {unit && <span className="ml-0.5 text-sm font-medium text-ink-faint">{unit}</span>}
        </p>
        {trendIcon && (
          <span className={cn("mb-1 flex items-center gap-0.5 text-[11px]", statusStyles[status])}>
            {trendIcon}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {sub && <p className="truncate text-[11px] text-ink-faint">{sub}</p>}
        {icon && <span className="text-ink-faint/60 group-hover:text-ink-faint">{icon}</span>}
      </div>
    </Wrapper>
  );
}
