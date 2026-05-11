"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { TargetVsActual } from "@/types/portfolio";

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-elevated text-sm"
      style={{ boxShadow: "var(--shadow-elevated)" }}>
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center justify-between gap-5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: p.fill }} />
            <span className="text-muted-foreground text-xs">{p.name}</span>
          </div>
          <span className="font-numeric font-semibold text-foreground">{p.value}%</span>
        </div>
      ))}
    </div>
  );
}

export function TargetVsActualChart({ targets }: { targets: TargetVsActual }) {
  const cash_target = parseFloat(
    ((1 - targets.targetEquityPct - targets.targetBondPct - targets.targetAltPct) * 100).toFixed(1)
  );

  const data = [
    { name: "Equities",    Target: +(targets.targetEquityPct * 100).toFixed(1), Actual: +(targets.currentEquityPct * 100).toFixed(1) },
    { name: "Bonds",       Target: +(targets.targetBondPct * 100).toFixed(1),   Actual: +(targets.currentBondPct * 100).toFixed(1) },
    { name: "Alternatives", Target: +(targets.targetAltPct * 100).toFixed(1),   Actual: +(targets.currentAltPct * 100).toFixed(1) },
    { name: "Cash",        Target: cash_target,                                  Actual: +(targets.currentCashPct * 100).toFixed(1) },
  ];

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
        <CartesianGrid strokeDasharray="0" stroke="hsl(222 28% 14%)" horizontal={true} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: "hsl(215 18% 45%)", fontSize: 11, fontFamily: "Plus Jakarta Sans" }}
          tickLine={false} axisLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: "hsl(215 18% 45%)", fontSize: 11, fontFamily: "Plus Jakarta Sans" }}
          tickLine={false} axisLine={false} width={36}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "hsl(215 18% 45%)", fontFamily: "Plus Jakarta Sans" }}
          iconType="square"
          iconSize={8}
        />
        <Bar dataKey="Target" fill="hsl(222 35% 22%)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        <Bar dataKey="Actual" fill="hsl(26 90% 54%)"  radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}
