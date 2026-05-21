import { Building2, HandCoins, ArrowLeft, Calendar } from "lucide-react";
import Link from "next/link";
import { getFixedPortfolioValues, getNonListedTransactions, getPrivateLoanTransactions } from "@/server/queries/admin";
import { dbEnabled } from "@/db/prisma";
import { NonListedValuesForm } from "@/components/admin/NonListedValuesForm";
import { PrivateLoanPrincipalForm } from "@/components/admin/PrivateLoanPrincipalForm";
import { DeleteEntryButton } from "@/components/admin/DeleteEntryButton";
import { formatEur, formatDate } from "@/lib/utils";

export default async function AdminNonListedPage() {
  const [values, transactions, loanTransactions] = await Promise.all([
    getFixedPortfolioValues(),
    getNonListedTransactions(),
    getPrivateLoanTransactions(),
  ]);
  const { privateParticipations, privateLoanPrincipal, history } = values;
  const totalNonListed = privateParticipations + privateLoanPrincipal;
  const nlHistory = history.filter((h) => h.privateParticipations > 0 || h.privateLoanPrincipal > 0);

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Non-Listed Assets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Enter approved participation rows in the same structure as the workbook register
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          className="rounded-2xl border border-border/60 p-5"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-purple-400" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Private Participations</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground leading-none">
            {privateParticipations > 0 ? formatEur(privateParticipations) : "-"}
          </p>
        </div>

        <div
          className="rounded-2xl border border-border/60 p-5"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <HandCoins className="w-4 h-4 text-blue-400" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Private Loan Principal</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground leading-none">
            {privateLoanPrincipal > 0 ? formatEur(privateLoanPrincipal) : "-"}
          </p>
        </div>

        <div
          className="rounded-2xl border border-primary/20 p-5"
          style={{ background: "hsl(26 90% 54% / 0.07)", boxShadow: "var(--shadow-gold)" }}
        >
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Total Non-Listed</p>
          <p className="font-numeric text-3xl font-bold text-gradient-gold leading-none">
            {totalNonListed > 0 ? formatEur(totalNonListed) : "-"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-purple-500/10">
              <Building2 className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Enter Participation Row</h2>
          </div>
          <div className="p-5">
            {!dbEnabled() ? (
              <div className="py-8 text-center">
                <Building2 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Database not configured</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Add DATABASE_URL in .env.</p>
              </div>
            ) : (
              <NonListedValuesForm />
            )}
          </div>
        </div>

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
            <h2 className="text-sm font-semibold text-foreground">Participation Register</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{transactions.length} entries</span>
          </div>
          {transactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Tipo</th>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Investee</th>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Valuta</th>
                    <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{formatDate(entry.date)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          entry.tipo === "BUY"
                            ? "border-success/25 bg-success/10 text-success"
                            : "border-destructive/25 bg-destructive/10 text-destructive"
                        }`}>
                          {entry.tipo}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-foreground">{entry.investee}</td>
                      <td className="px-5 py-3.5 text-xs font-semibold text-muted-foreground">{entry.currency}</td>
                      <td className="px-5 py-3.5 text-right font-numeric text-sm font-semibold text-foreground">
                        {formatEur(entry.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <Building2 className="w-10 h-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No participation entries yet</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <HandCoins className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Enter Private Loan Row</h2>
          </div>
          <div className="p-5">
            {!dbEnabled() ? (
              <div className="py-8 text-center">
                <HandCoins className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Database not configured</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Add DATABASE_URL in .env.</p>
              </div>
            ) : (
              <PrivateLoanPrincipalForm />
            )}
          </div>
        </div>

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
            <h2 className="text-sm font-semibold text-foreground">Private Loan Register</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{loanTransactions.length} entries</span>
          </div>
          {loanTransactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Tipo</th>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Counterparty</th>
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Valuta</th>
                    <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {loanTransactions.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{formatDate(entry.date)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          entry.tipo === "DISBURSEMENT"
                            ? "border-success/25 bg-success/10 text-success"
                            : "border-destructive/25 bg-destructive/10 text-destructive"
                        }`}>
                          {entry.tipo}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-foreground">{entry.counterparty}</td>
                      <td className="px-5 py-3.5 text-xs font-semibold text-muted-foreground">{entry.currency}</td>
                      <td className="px-5 py-3.5 text-right font-numeric text-sm font-semibold text-foreground">
                        {formatEur(entry.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <HandCoins className="w-10 h-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No private loan entries yet</p>
            </div>
          )}
        </div>
      </div>

      {nlHistory.length > 0 && (
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
            <h2 className="text-sm font-semibold text-foreground">Approved Balance History</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{nlHistory.length} dates</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Participations</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Loans</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Total</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {nlHistory.map((h) => (
                  <tr key={h.asOfDate} className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors">
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{formatDate(h.asOfDate)}</td>
                    <td className="px-5 py-3.5 text-right font-numeric text-sm font-semibold text-purple-400">
                      {h.privateParticipations > 0 ? formatEur(h.privateParticipations) : "-"}
                    </td>
                    <td className="px-5 py-3.5 text-right font-numeric text-sm font-semibold text-blue-400">
                      {h.privateLoanPrincipal > 0 ? formatEur(h.privateLoanPrincipal) : "-"}
                    </td>
                    <td className="px-5 py-3.5 text-right font-numeric text-sm font-bold text-foreground">
                      {formatEur(h.privateParticipations + h.privateLoanPrincipal)}
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <DeleteEntryButton
                        asOfDate={h.asOfDate}
                        itemKeys={h.itemKeys}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
