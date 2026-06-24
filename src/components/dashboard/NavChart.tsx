"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { NavPoint } from "@/types/portfolio";
import { formatEur } from "@/lib/utils";

interface NavChartProps {
  data: NavPoint[];
}

function tick(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = new Date(label);
  const dateLabel = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-elevated text-sm"
      style={{ boxShadow: "var(--shadow-elevated)" }}>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{dateLabel}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground text-xs">{p.dataKey === "nav" ? "NAV" : "TWR Index"}</span>
          </div>
          <span className="font-numeric font-semibold text-foreground">
            {p.dataKey === "nav" ? formatEur(p.value) : `${p.value?.toFixed(1)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function NavChart({ data }: NavChartProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">📈</span>
        <p className="text-sm">No NAV data available</p>
      </div>
    );
  }

  if (!mounted) {
    return <div className="h-[300px]" aria-hidden="true" />;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(26 90% 54%)" stopOpacity={0.25} />
            <stop offset="80%" stopColor="hsl(26 90% 54%)" stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id="twrGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(150 60% 40%)" stopOpacity={0.2} />
            <stop offset="80%" stopColor="hsl(150 60% 40%)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="0"
          stroke="hsl(222 28% 14%)"
          horizontal={true}
          vertical={false}
        />
        <XAxis
          dataKey="monthEnd"
          tickFormatter={tick}
          tick={{ fill: "hsl(215 18% 42%)", fontSize: 11, fontFamily: "Plus Jakarta Sans" }}
          tickLine={false}
          axisLine={false}
          dy={8}
        />
        <YAxis
          yAxisId="nav"
          orientation="left"
          tickFormatter={(v: number) => {
            if (Math.abs(v) >= 1_000_000) {
              const m = v / 1_000_000;
              return `€${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
            }
            return `€${(v / 1_000).toFixed(0)}k`;
          }}
          tick={{ fill: "hsl(215 18% 42%)", fontSize: 11, fontFamily: "Plus Jakarta Sans" }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <YAxis
          yAxisId="twr"
          orientation="right"
          tickFormatter={(v: number) => v.toFixed(0)}
          tick={{ fill: "hsl(215 18% 42%)", fontSize: 11, fontFamily: "Plus Jakarta Sans" }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip />} />

        <Area
          yAxisId="nav"
          type="monotone"
          dataKey="nav"
          stroke="hsl(26 90% 54%)"
          strokeWidth={2}
          fill="url(#navGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "hsl(26 90% 54%)", strokeWidth: 0 }}
        />
        <Line
          yAxisId="twr"
          type="monotone"
          dataKey="normalized"
          stroke="hsl(150 60% 40%)"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          activeDot={{ r: 3, fill: "hsl(150 60% 40%)", strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
