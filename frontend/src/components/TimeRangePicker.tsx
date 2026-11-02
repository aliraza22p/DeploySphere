import { cn } from "../lib/utils";

export type RangeKey = "1h" | "24h" | "7d" | "30d";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "1h", label: "1 hour" },
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export function TimeRangePicker({
  value,
  onChange,
  className,
}: {
  value: RangeKey;
  onChange: (range: RangeKey) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Select time range"
      className={cn(
        "inline-flex rounded-md border border-line bg-surface-2 p-0.5",
        className,
      )}
    >
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          aria-pressed={value === r.key}
          className={cn(
            "rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent/70",
            value === r.key
              ? "bg-accent text-white shadow-sm"
              : "text-ink-muted hover:bg-surface-4 hover:text-ink",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
