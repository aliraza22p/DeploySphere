import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-line px-1"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent/70 rounded-t-md",
            active === tab.id
              ? "text-ink"
              : "text-ink-faint hover:text-ink-muted",
          )}
        >
          {tab.label}
          {typeof tab.count === "number" && (
            <span
              className={cn(
                "ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                active === tab.id ? "bg-accent/20 text-accent" : "bg-surface-4 text-ink-faint",
              )}
            >
              {tab.count}
            </span>
          )}
          {active === tab.id && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" aria-hidden />
          )}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <div role="tabpanel">{children}</div>;
}
