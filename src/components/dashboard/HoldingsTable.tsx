import type { Holding } from "@/types/portfolio";
import { formatEur, formatPct, pnlColor, cn } from "@/lib/utils";

const CLASS_BADGE: Record<string, string> = {
  "Stocks":       "bg-primary/10 text-primary border-primary/20",
  "Bonds":        "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "ETFs / ETCs":  "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Crypto ETPs":  "bg-warning/10 text-warning border-warning/20",
  "Cash":         "bg-success/10 text-success border-success/20",
  "Alternatives": "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

function classBadge(cls: string) {
  return CLASS_BADGE[cls] ?? "bg-secondary text-muted-foreground border-border";
}

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const open = holdings.filter((h) => h.shares > 0).sort((a, b) => b.marketValue - a.marketValue);

  if (!open.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">📊</span>
        <p className="text-sm">No open positions</p>
      </div>
    );
  }

  const totalValue = open.reduce((s, h) => s + h.marketValue, 0);

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <div className="max-h-[520px] overflow-auto">
      <table className="w-full min-w-[780px] text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
            {["Security", "Class", "Mkt Value", "P&L", "P&L %", "Weight"].map((h) => (
              <th key={h}
                className="px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest text-right first:text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {open.map((h, i) => (
            <tr key={i}
              className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors group">
              {/* Security name */}
              <td className="px-4 py-3.5">
                <div className="font-medium text-foreground text-sm truncate max-w-[200px]">{h.security}</div>
                <div className="text-[11px] text-muted-foreground font-numeric mt-0.5">
                  {h.shares.toLocaleString("en-US")} units · avg {formatEur(h.avgCost)}
                </div>
              </td>

              {/* Asset class */}
              <td className="px-4 py-3.5">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${classBadge(h.assetClass)}`}>
                  {h.assetClass}
                </span>
              </td>

              {/* Market value */}
              <td className="px-4 py-3.5 text-right">
                <div className="font-numeric font-semibold text-foreground">{formatEur(h.marketValue)}</div>
                {/* Weight bar */}
                <div className="flex justify-end mt-1">
                  <div className="w-16 h-1 rounded-full bg-secondary/50 overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60"
                      style={{ width: `${Math.min((h.marketValue / totalValue) * 100 * 2, 100)}%` }} />
                  </div>
                </div>
              </td>

              {/* P&L */}
              <td className={cn("px-4 py-3.5 text-right font-numeric font-semibold", pnlColor(h.unrealizedPnl))}>
                {formatEur(h.unrealizedPnl)}
              </td>

              {/* P&L % */}
              <td className={cn("px-4 py-3.5 text-right font-numeric font-semibold", pnlColor(h.pnlPct))}>
                {formatPct(h.pnlPct)}
              </td>

              {/* Weight */}
              <td className="px-4 py-3.5 text-right font-numeric text-muted-foreground text-sm">
                {(h.weight * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-10">
          <tr className="border-t border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
            <td className="px-4 py-3 text-xs font-semibold text-muted-foreground" colSpan={2}>
              {open.length} open positions
            </td>
            <td className="px-4 py-3 text-right font-numeric font-bold text-foreground">
              {formatEur(totalValue)}
            </td>
            <td className={cn("px-4 py-3 text-right font-numeric font-bold",
              pnlColor(open.reduce((s, h) => s + h.unrealizedPnl, 0)))}>
              {formatEur(open.reduce((s, h) => s + h.unrealizedPnl, 0))}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}
