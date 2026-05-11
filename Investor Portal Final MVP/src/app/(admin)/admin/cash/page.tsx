import { Wallet, Calendar, ArrowLeft, CreditCard } from "lucide-react";
import Link from "next/link";
import { getAdminData } from "@/server/queries/admin";
import { dbEnabled } from "@/db/client";
import { CashValuesForm } from "@/components/admin/CashValuesForm";
import { formatEur, formatDate } from "@/lib/utils";

export default async function AdminCashPage() {
  const { dictionary, manualValues } = await getAdminData();
  const cashValues = manualValues.filter((v) => v.itemKey.startsWith("cash"));

  // Latest per account
  const latestByKey = new Map<string, typeof cashValues[number]>();
  for (const v of cashValues) {
    const existing = latestByKey.get(v.itemKey);
    if (!existing || v.valueDate > existing.valueDate) latestByKey.set(v.itemKey, v);
  }
  const latestRows = [...latestByKey.values()].sort((a, b) => b.value - a.value);
  const totalCash = latestRows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Cash &amp; Liquidity</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Enter monthly balances for cash accounts and external liquidity
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

      {/* Hero total */}
      {latestRows.length > 0 && (
        <div
          className="rounded-2xl border border-blue-500/20 p-6 flex items-end justify-between gap-4"
          style={{ background: "hsl(217 91% 60% / 0.07)", boxShadow: "var(--shadow-card)" }}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              Total Cash (latest balances)
            </p>
            <p className="font-numeric text-5xl font-bold text-blue-400 leading-none">{formatEur(totalCash)}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {latestRows.length} {latestRows.length === 1 ? "account" : "accounts"} · {cashValues.length} total entries
            </p>
          </div>
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <Wallet className="w-7 h-7 text-blue-400" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Insert form */}
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <CreditCard className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Enter Balance</h2>
          </div>
          <div className="p-5">
            {!dbEnabled() ? (
              <div className="py-8 text-center">
                <Wallet className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Database not configured</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Add DATABASE_URL in .env.local.</p>
              </div>
            ) : (
              <CashValuesForm items={dictionary} />
            )}
          </div>
        </div>

        {/* Latest balances per account */}
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
            <h2 className="text-sm font-semibold text-foreground">Current Balances by Account</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{latestRows.length} accounts</span>
          </div>
          {latestRows.length > 0 ? (
            <div className="divide-y divide-border/40">
              {latestRows.map((r) => (
                <div
                  key={r.itemKey}
                  className="flex items-center justify-between px-5 py-4 hover:bg-secondary/20 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{r.displayName}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{r.itemKey}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="font-numeric text-base font-bold text-blue-400">{formatEur(r.value)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(r.valueDate)}</p>
                    {totalCash > 0 && (
                      <p className="font-numeric text-[10px] text-muted-foreground/60 mt-0.5">
                        {((r.value / totalCash) * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-5 py-3 bg-secondary/20">
                <p className="text-xs font-semibold text-muted-foreground">{latestRows.length} accounts</p>
                <p className="font-numeric font-bold text-foreground">{formatEur(totalCash)}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <Wallet className="w-10 h-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No balances entered</p>
            </div>
          )}
        </div>
      </div>

      {/* Full history */}
      {cashValues.length > 0 && (
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
            <h2 className="text-sm font-semibold text-foreground">Balance History</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">last {Math.min(cashValues.length, 30)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Account</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Balance</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden sm:table-cell">Entered on</th>
                </tr>
              </thead>
              <tbody>
                {cashValues.slice(0, 30).map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-foreground">{v.displayName}</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{v.itemKey}</p>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="font-numeric text-sm font-bold text-blue-400">{formatEur(v.value)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-xs text-muted-foreground">{formatDate(v.valueDate)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right hidden sm:table-cell">
                      <span className="text-xs text-muted-foreground/60">
                        {v.createdAt ? formatDate(v.createdAt.split("T")[0]) : "—"}
                      </span>
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
