"use client";

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { AllocationSlice } from "@/types/portfolio";
import { formatEur } from "@/lib/utils";

const PALETTE = [
  "hsl(26 90% 54%)",
  "hsl(150 60% 40%)",
  "hsl(217 91% 62%)",
  "hsl(280 65% 62%)",
  "hsl(38 95% 52%)",
  "hsl(0 72% 54%)",
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-elevated text-sm"
      style={{ boxShadow: "var(--shadow-elevated)" }}>
      <p className="font-semibold text-foreground mb-1">{d.name}</p>
      <p className="font-numeric text-primary font-bold">{formatEur(d.value)}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{(d.payload.weight * 100).toFixed(1)}% of total</p>
    </div>
  );
}

export function AllocationChart({ data }: { data: AllocationSlice[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!data.length) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No data available</div>
  );

  if (!mounted) {
    return <div className="h-[220px]" aria-hidden="true" />;
  }

  const total = data.reduce((s, d) => s + d.marketValue, 0);

  return (
    <div className="flex flex-col gap-5">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={96}
            dataKey="marketValue"
            nameKey="assetClass"
            paddingAngle={3}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={d.assetClass} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 w-2.5 h-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-xs text-muted-foreground truncate">{d.assetClass}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-20 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                <div className="h-full rounded-full" style={{
                  width: `${(d.marketValue / total) * 100}%`,
                  background: PALETTE[i % PALETTE.length],
                  opacity: 0.8,
                }} />
              </div>
              <span className="font-numeric text-xs font-semibold text-foreground w-10 text-right">
                {(d.weight * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
