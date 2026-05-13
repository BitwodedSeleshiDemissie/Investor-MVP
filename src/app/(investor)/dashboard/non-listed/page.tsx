import { Building2, Database } from "lucide-react";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { getLatestManualRows } from "@/server/queries/admin";
import { dbEnabled } from "@/db/client";
import { formatEur, formatDate } from "@/lib/utils";

export default async function NonListedPage() {
  const snap = await getPortfolioSnapshot();
  const { composition, cutoffDate } = snap;
  const rows = await getLatestManualRows(cutoffDate, "non_listed");
  const total = rows.length > 0
    ? rows.reduce((s, r) => s + r.value, 0)
    : composition.nonListed;

  return (
    <div className="space-y-5 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Non-Listed / Approved Values</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Monthly values approved by administrator - {cutoffDate}
        </p>
      </div>

      {/* Hero metric */}
      <div className="rounded-2xl border border-border/60 p-6 flex items-end justify-between gap-4"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}>
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Total Non-Listed</p>
          <p className="font-numeric text-5xl font-bold text-foreground leading-none">{formatEur(total)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {rows.length > 0 ? `${rows.length} assets - last admin valuation` : "No admin values entered yet"}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <Building2 className="w-7 h-7 text-purple-400" />
        </div>
      </div>

      {/* DB not configured notice */}
      {!dbEnabled() && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/8 border border-warning/20 text-sm">
          <Database className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-warning">Database not configured</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              Configure DATABASE_URL in .env and use the Admin panel to enter monthly values.
              The total shown comes from the shared database once values are entered.
            </p>
          </div>
        </div>
      )}

      {/* Values table */}
      {rows.length > 0 ? (
        <div className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}>
            <div className="p-1.5 rounded-lg bg-purple-500/10">
              <Building2 className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Latest Valuations per Asset</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">Latest value per asset</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Asset</th>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden sm:table-cell">Holding</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Approved Value</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden lg:table-cell">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .sort((a, b) => b.value - a.value)
                  .map((r) => (
                    <tr key={r.itemKey}
                      className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">{r.displayName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{r.itemKey}</p>
                      </td>
                      <td className="px-5 py-4 hidden sm:table-cell text-sm text-muted-foreground">
                        {r.holdingName ?? "-"}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="font-numeric text-base font-bold text-purple-400">{formatEur(r.value)}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="text-xs text-muted-foreground">{formatDate(r.valueDate)}</span>
                      </td>
                      <td className="px-5 py-4 text-right hidden lg:table-cell">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                            <div className="h-full rounded-full bg-purple-500/60"
                              style={{ width: `${total > 0 ? (r.value / total) * 100 : 0}%` }} />
                          </div>
                          <span className="font-numeric text-xs text-muted-foreground w-10 text-right">
                            {total > 0 ? ((r.value / total) * 100).toFixed(1) : 0}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                  <td className="px-5 py-3 text-xs font-semibold text-muted-foreground" colSpan={2}>{rows.length} assets</td>
                  <td className="px-5 py-3 text-right font-numeric font-bold text-foreground text-base">{formatEur(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-border/60 bg-card">
          <Building2 className="w-10 h-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">No non-listed values entered</p>
          <p className="text-xs text-muted-foreground/60">Use the Admin panel to add assets and enter monthly valuations.</p>
        </div>
      )}
    </div>
  );
}
