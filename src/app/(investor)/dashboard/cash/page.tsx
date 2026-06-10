import { Wallet } from "lucide-react";
import { redirect } from "next/navigation";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { cleanDisplayName, getSession } from "@/lib/auth";
import { formatDate, formatEur } from "@/lib/utils";

export default async function CashPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const investorName = cleanDisplayName(session.investorName);
  if (session.role === "investor" && !investorName) redirect("/login");

  const snap = await getPortfolioSnapshot(session.role === "admin" ? undefined : investorName);
  const { composition, directaCash, cutoffDate } = snap;
  const positionsAsOf = snap.dataFreshness?.positionsAsOf ?? cutoffDate;
  const directa    = directaCash || 0;
  const totalCash  = composition.cash || directa;
  const externalFromComposition = Math.max(0, totalCash - directa);
  const statementPct = totalCash > 0 ? Math.min(100, (directa / totalCash) * 100) : 0;
  const externalDisplay = externalFromComposition;
  const externalPct = totalCash > 0 ? Math.min(100, (externalDisplay / totalCash) * 100) : 0;

  const rows: Array<{ label: string; value: number }> = [];
  if (directa > 0) {
    rows.push({ label: "Brokerage Account Cash", value: directa });
  }
  if (externalDisplay > 0) {
    rows.push({
      label: "Cash Outside Brokerage Account",
      value: externalDisplay,
    });
  }

  return (
    <div className="space-y-5 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Cash &amp; Liquidity</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Cash balances by account as of {formatDate(positionsAsOf)}
        </p>
      </div>

      {/* Hero + breakdown side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-1 rounded-2xl border border-blue-500/20 p-6 flex flex-col justify-between"
          style={{ background: "hsl(217 91% 60% / 0.07)", boxShadow: "var(--shadow-card)" }}>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Total Cash</p>
            <p className="font-numeric text-4xl font-bold text-blue-400 leading-none">{formatEur(totalCash)}</p>
          </div>
          <div className="mt-4 pt-4 border-t border-border/60 flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Wallet className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-xs text-muted-foreground">
              {rows.length > 0 ? `${rows.length} accounts` : "No external balances entered yet"}
            </p>
          </div>
        </div>

        <div className="sm:col-span-2 grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border/60 p-5 bg-secondary/20">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Brokerage Account Cash</p>
            <p className="font-numeric text-3xl font-bold text-foreground leading-none">
              {formatEur(directa)}
            </p>
            {totalCash > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                  <div className="h-full rounded-full bg-primary/60"
                    style={{ width: `${statementPct}%` }} />
                </div>
                <span className="font-numeric text-xs text-muted-foreground">
                  {statementPct.toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 p-5 bg-secondary/20">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Cash Outside Brokerage</p>
            <p className="font-numeric text-3xl font-bold text-foreground leading-none">
              {formatEur(externalDisplay)}
            </p>
            {totalCash > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500/60"
                    style={{ width: `${externalPct}%` }} />
                </div>
                <span className="font-numeric text-xs text-muted-foreground">
                  {externalPct.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Breakdown table */}
      {rows.length > 0 && (
        <div className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}>
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <Wallet className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Account Breakdown</h2>
          </div>
          <div className="divide-y divide-border/40">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-4 hover:bg-secondary/20 transition-colors">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.label}</p>
                </div>
                <div className="text-right">
                  <p className="font-numeric text-base font-bold text-blue-400">{formatEur(r.value)}</p>
                  {totalCash > 0 && (
                    <p className="font-numeric text-xs text-muted-foreground mt-0.5">
                      {((r.value / totalCash) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between px-5 py-3 bg-secondary/20">
              <p className="text-xs font-semibold text-muted-foreground">{rows.length} accounts</p>
              <p className="font-numeric font-bold text-foreground">{formatEur(totalCash)}</p>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-border/60 bg-card">
          <Wallet className="w-10 h-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">No cash details available</p>
        </div>
      )}
    </div>
  );
}
