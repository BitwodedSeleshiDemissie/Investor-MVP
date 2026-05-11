import { TrendingUp, List, Activity, AlertCircle } from "lucide-react";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { HoldingsTable } from "@/components/dashboard/HoldingsTable";
import { RiskMetricsBlock } from "@/components/dashboard/RiskMetrics";
import { formatEur, formatPct, pnlColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 overflow-hidden"
      style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
        style={{ background: "hsl(222 44% 7%)" }}>
        <div className="p-1.5 rounded-lg bg-primary/10">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default async function ListedPage() {
  const snap = await getPortfolioSnapshot();
  const { holdings, composition, risk, pnl, allocation, kpis, cutoffDate } = snap;

  const listed = holdings.filter(
    (h) => h.shares > 0 && !["private", "non-listed", "unlisted", "alternatives"].some(
      (s) => h.assetClass.toLowerCase().includes(s)
    )
  );
  const listedTotal = listed.reduce((s, h) => s + h.marketValue, 0);
  const listedPnl   = listed.reduce((s, h) => s + h.unrealizedPnl, 0);
  const listedCost  = listed.reduce((s, h) => s + h.costBasis, 0);
  const listedPnlPct = listedCost > 0 ? listedPnl / listedCost : 0;

  const byClass = allocation.filter((s) => s.assetClass !== "Cash");
  const totalAlloc = byClass.reduce((s, a) => s + a.marketValue, 0);

  return (
    <div className="space-y-5 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Listed / Market-Priced</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Market-priced assets via Directa/Vasco · {cutoffDate}
        </p>
      </div>

      {/* Hero metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-primary/20 p-6"
          style={{ background: "hsl(26 90% 54% / 0.07)", boxShadow: "var(--shadow-gold)" }}>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Listed Value</p>
          <p className="font-numeric text-4xl font-bold text-gradient-gold leading-none">{formatEur(listedTotal)}</p>
          <p className="text-xs text-muted-foreground mt-2">{listed.length} open positions</p>
        </div>

        <div className="rounded-2xl border border-border/60 p-6 bg-secondary/20">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Unrealized P&amp;L</p>
          <p className={cn("font-numeric text-4xl font-bold leading-none", pnlColor(listedPnl))}>{formatEur(listedPnl)}</p>
          <p className={cn("text-xs mt-2 font-medium", pnlColor(listedPnlPct))}>{formatPct(listedPnlPct)} on cost</p>
        </div>

        <div className="rounded-2xl border border-border/60 p-6 bg-secondary/20">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Breakdown by Class</p>
          <div className="space-y-2 mt-1">
            {byClass.slice(0, 4).map((a) => (
              <div key={a.assetClass} className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground truncate">{a.assetClass}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-16 h-1 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70"
                      style={{ width: `${totalAlloc > 0 ? (a.marketValue / totalAlloc) * 100 : 0}%` }} />
                  </div>
                  <span className="font-numeric text-xs font-semibold text-foreground w-9 text-right">
                    {(a.weight * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Risk (listed-specific) */}
      <Section title="Risk Metrics — Listed Portfolio" icon={Activity}>
        <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-secondary/30 border border-border/60 text-xs text-muted-foreground">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
          Risk metrics are calculated on the historical NAV of the listed portfolio (Directa/Vasco preprocessing).
          TWR, volatility, Sharpe and drawdown reflect only market-priced assets.
        </div>
        <RiskMetricsBlock risk={risk} />
      </Section>

      {/* Holdings */}
      <Section title="Listed Holdings" icon={List}>
        <HoldingsTable holdings={listed} />
      </Section>
    </div>
  );
}
