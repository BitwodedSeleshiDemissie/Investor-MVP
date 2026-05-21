import { Wallet, CreditCard, ArrowLeft, Calendar } from "lucide-react";
import Link from "next/link";
import { getFixedPortfolioValues } from "@/server/queries/admin";
import { dbEnabled } from "@/db/prisma";
import { CashOutsideDirectaForm } from "@/components/admin/CashOutsideDirectaForm";
import { DeleteEntryButton } from "@/components/admin/DeleteEntryButton";
import { formatEur, formatDate } from "@/lib/utils";

export default async function AdminCashPage() {
  const values = await getFixedPortfolioValues();
  const { cashOutsideDirecta, cashOutsideDirectaSource, statementCash, history } = values;
  const totalCash = statementCash + cashOutsideDirecta;
  const cashHistory = history.filter((h) => h.itemKeys.includes("CASH_OUTSIDE_DIRECTA"));

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Cash</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Statement cash comes from Directa automatically — add to or set external cash here
          </p>
        </div>
        <Link
          href="/admin"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          className="rounded-2xl border border-border/60 p-5"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <CreditCard className="w-4 h-4 text-emerald-400" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Statement Cash</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground leading-none">
            {statementCash > 0 ? formatEur(statementCash) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">From Directa CSV</p>
        </div>

        <div
          className="rounded-2xl border border-border/60 p-5"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-blue-400" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Cash Outside Directa</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground leading-none">
            {cashOutsideDirecta > 0 ? formatEur(cashOutsideDirecta) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">
            {cashOutsideDirectaSource === "snapshot" ? "Current approved data" : "Manually entered"}
          </p>
        </div>

        <div
          className="rounded-2xl border border-primary/20 p-5"
          style={{ background: "hsl(26 90% 54% / 0.07)", boxShadow: "var(--shadow-gold)" }}
        >
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Total Cash</p>
          <p className="font-numeric text-3xl font-bold text-gradient-gold leading-none">
            {totalCash > 0 ? formatEur(totalCash) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">Statement + External</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <Wallet className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Cash Outside Directa</h2>
          </div>
          <div className="p-5">
            {!dbEnabled() ? (
              <div className="py-8 text-center">
                <Wallet className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Database not configured</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Add DATABASE_URL in .env.</p>
              </div>
            ) : (
              <CashOutsideDirectaForm currentCashOutside={cashOutsideDirecta} />
            )}
          </div>
        </div>

        {/* History */}
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-secondary/60">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Approved Cash Balance History</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{cashHistory.length} entries</span>
          </div>
          {cashHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
                    <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Cash Outside Directa</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {cashHistory.map((h) => (
                    <tr key={h.asOfDate} className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{formatDate(h.asOfDate)}</td>
                      <td className="px-5 py-3.5 text-right font-numeric text-sm font-bold text-blue-400">
                        {formatEur(h.cashOutsideDirecta)}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <DeleteEntryButton
                          asOfDate={h.asOfDate}
                          itemKeys={h.itemKeys.filter((key) => key === "CASH_OUTSIDE_DIRECTA")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <Wallet className="w-10 h-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No entries yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
