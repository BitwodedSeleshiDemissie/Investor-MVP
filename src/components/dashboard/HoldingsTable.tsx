"use client";

import { useMemo, useState } from "react";
import type { Holding } from "@/types/portfolio";
import { formatEur } from "@/lib/utils";

const CLASS_BADGE: Record<string, string> = {
  Stocks: "bg-primary/10 text-primary border-primary/20",
  Bonds: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "ETFs / ETCs": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Crypto ETPs": "bg-warning/10 text-warning border-warning/20",
  Cash: "bg-success/10 text-success border-success/20",
  Alternatives: "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

function classBadge(cls: string) {
  return CLASS_BADGE[cls] ?? "bg-secondary text-muted-foreground border-border";
}

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const open = useMemo(
    () => holdings.filter((h) => h.shares > 0).sort((a, b) => b.marketValue - a.marketValue),
    [holdings]
  );
  const assetClasses = useMemo(
    () => Array.from(new Set(open.map((h) => h.assetClass))).sort((a, b) => a.localeCompare(b)),
    [open]
  );
  const [selectedClass, setSelectedClass] = useState("All");
  const filtered = selectedClass === "All" ? open : open.filter((h) => h.assetClass === selectedClass);

  if (!open.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
        <span className="text-sm font-semibold uppercase tracking-widest opacity-60">No positions</span>
        <p className="text-sm">No open positions</p>
      </div>
    );
  }

  const totalValue = open.reduce((s, h) => s + h.marketValue, 0);
  const filteredValue = filtered.reduce((s, h) => s + h.marketValue, 0);

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border/60 p-3" style={{ background: "hsl(222 35% 10%)" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Filter by type</p>
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {open.length} open positions
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["All", ...assetClasses].map((assetClass) => {
            const active = selectedClass === assetClass;
            return (
              <button
                key={assetClass}
                type="button"
                onClick={() => setSelectedClass(assetClass)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border/70 bg-secondary/20 text-muted-foreground hover:text-foreground"
                }`}
              >
                {assetClass}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
              {["Security", "Type", "Market Value", "Weight", "ISIN"].map((h) => (
                <th
                  key={h}
                  className={`px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest ${
                    h === "Security" || h === "ISIN" ? "text-left" : "text-right"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((h) => (
              <tr
                key={`${h.security}-${h.isin ?? ""}-${h.assetClass}`}
                className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors group"
              >
                <td className="px-4 py-3.5">
                  <div className="font-medium text-foreground text-sm truncate max-w-[240px]">{h.security}</div>
                  <div className="text-[11px] text-muted-foreground font-numeric mt-0.5">{h.currency}</div>
                </td>

                <td className="px-4 py-3.5 text-right">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${classBadge(h.assetClass)}`}>
                    {h.assetClass}
                  </span>
                </td>

                <td className="px-4 py-3.5 text-right">
                  <div className="font-numeric font-semibold text-foreground">{formatEur(h.marketValue)}</div>
                  <div className="flex justify-end mt-1">
                    <div className="w-16 h-1 rounded-full bg-secondary/50 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${totalValue > 0 ? Math.min((h.marketValue / totalValue) * 200, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </td>

                <td className="px-4 py-3.5 text-right font-numeric text-muted-foreground text-sm">
                  {(h.weight * 100).toFixed(1)}%
                </td>

                <td className="px-4 py-3.5 text-left">
                  <span className="font-numeric text-xs text-muted-foreground">{h.isin || "-"}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">
            <tr className="border-t border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
              <td className="px-4 py-3 text-xs font-semibold text-muted-foreground" colSpan={2}>
                {selectedClass === "All" ? "All types" : selectedClass}
              </td>
              <td className="px-4 py-3 text-right font-numeric font-bold text-foreground">
                {formatEur(filteredValue)}
              </td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
