import { Wallet, CreditCard, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getFixedPortfolioValues } from "@/server/queries/admin";
import { dbEnabled } from "@/db/prisma";
import { CashOutsideDirectaForm } from "@/components/admin/CashOutsideDirectaForm";
import { formatEur } from "@/lib/utils";

export default async function AdminCashPage() {
  const values = await getFixedPortfolioValues();
  const { cashOutsideDirecta, cashOutsideDirectaSource, statementCash } = values;
  const totalCash = statementCash + cashOutsideDirecta;

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Cash</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Brokerage cash comes from the Directa PDF; cash outside brokerage is entered manually
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
            <CreditCard className="w-4 h-4 text-emerald-400" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Brokerage Account Cash</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground leading-none">
            {statementCash > 0 ? formatEur(statementCash) : "-"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">From Directa PDF liquidity</p>
        </div>

        <div
          className="rounded-2xl border border-border/60 p-5"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-blue-400" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Cash Outside Brokerage</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground leading-none">
            {cashOutsideDirecta > 0 ? formatEur(cashOutsideDirecta) : "-"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">
            {cashOutsideDirectaSource === "manual"
              ? "Approved manual value"
              : cashOutsideDirectaSource === "calculated"
                ? "Calculated fallback"
                : "Source record fallback"}
          </p>
        </div>

        <div
          className="rounded-2xl border border-primary/20 p-5"
          style={{ background: "hsl(26 90% 54% / 0.07)", boxShadow: "var(--shadow-gold)" }}
        >
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Total Cash</p>
          <p className="font-numeric text-3xl font-bold text-gradient-gold leading-none">
            {totalCash > 0 ? formatEur(totalCash) : "-"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">Brokerage + outside brokerage</p>
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
          <div className="p-1.5 rounded-lg bg-blue-500/10">
            <Wallet className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Cash Outside Brokerage</h2>
        </div>
        <div className="p-5 space-y-4">
          {!dbEnabled() ? (
            <div className="py-8 text-center">
              <Wallet className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Database not configured</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Add DATABASE_URL in .env.</p>
            </div>
          ) : (
            <>
              <CashOutsideDirectaForm currentValue={cashOutsideDirecta} />
              <p className="text-xs text-muted-foreground">
                This approved balance is used in the next Directa upload. The residual formula remains only as a fallback when no manual outside-cash value exists.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
