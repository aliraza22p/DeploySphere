import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { formatTimestamp, formatNumber } from "../../lib/utils";

export interface SeriesPoint {
  time: number;
  value?: number | null;
  [key: string]: number | string | null | undefined;
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export function TrendChart({
  data,
  series,
  height = 240,
  type = "line",
  unit = "",
  yDomain,
  showLegend = true,
  stackedArea = false,
}: {
  data: SeriesPoint[];
  series: ChartSeries[];
  height?: number;
  type?: "line" | "area" | "bar";
  unit?: string;
  yDomain?: [number, number];
  showLegend?: boolean;
  stackedArea?: boolean;
}) {
  const grid = useMemo(
    () => <CartesianGrid strokeDasharray="3 3" stroke="#33415566" vertical={false} />,
    [],
  );

  const tooltipFormatter = (value: unknown, name: string) => {
    const v = typeof value === "number" ? formatNumber(value) : value;
    return [`${v}${unit}`, name];
  };

  const renderLines = () =>
    series.map((s) => (
      <Line
        key={s.key}
        type="monotone"
        dataKey={s.key}
        name={s.label}
        stroke={s.color}
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 3, strokeWidth: 0 }}
        connectNulls
      />
    ));

  const renderAreas = () =>
    series.map((s) => (
      <Area
        key={s.key}
        type="monotone"
        dataKey={s.key}
        name={s.label}
        stroke={s.color}
        strokeWidth={2}
        fill={s.color}
        fillOpacity={stackedArea ? 0.25 : 0.12}
        stackId={stackedArea ? "stack" : undefined}
        dot={false}
        activeDot={{ r: 3, strokeWidth: 0 }}
        connectNulls
      />
    ));

  const renderBars = () =>
    series.map((s) => (
      <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
    ));

  return (
    <div style={{ width: "100%", height }} role="img" aria-label="Time series chart">
      <ResponsiveContainer width="100%" height="100%">
        {type === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            {grid}
            <XAxis
              dataKey="time"
              tickFormatter={formatTimestamp}
              stroke="#64748b"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={yDomain ?? ["auto", "auto"]}
              width={50}
              tickFormatter={(v: number) => `${formatNumber(v)}${unit}`}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 12,
                color: "#e2e8f0",
              }}
              labelFormatter={(v) => formatTimestamp(Number(v))}
              formatter={tooltipFormatter}
            />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />}
            {renderBars()}
          </BarChart>
        ) : type === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            {grid}
            <XAxis
              dataKey="time"
              tickFormatter={formatTimestamp}
              stroke="#64748b"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={yDomain ?? ["auto", "auto"]}
              width={50}
              tickFormatter={(v: number) => `${formatNumber(v)}${unit}`}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 12,
                color: "#e2e8f0",
              }}
              labelFormatter={(v) => formatTimestamp(Number(v))}
              formatter={tooltipFormatter}
            />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />}
            {renderAreas()}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            {grid}
            <XAxis
              dataKey="time"
              tickFormatter={formatTimestamp}
              stroke="#64748b"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={yDomain ?? ["auto", "auto"]}
              width={50}
              tickFormatter={(v: number) => `${formatNumber(v)}${unit}`}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 12,
                color: "#e2e8f0",
              }}
              labelFormatter={(v) => formatTimestamp(Number(v))}
              formatter={tooltipFormatter}
            />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />}
            {renderLines()}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Convert API series [{time, values:{...}}] into chart points. */
export function toChartPoints(
  series: { time: number; values: Record<string, number | null> }[],
): SeriesPoint[] {
  return series.map((s) => ({ time: s.time * 1000, ...s.values }));
}
