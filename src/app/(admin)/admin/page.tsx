import { Building2, Wallet, Settings, Database, TrendingUp, List, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { getAdminData } from "@/server/queries/admin";
import { dbEnabled } from "@/db/client";
import { formatEur, formatDate } from "@/lib/utils";

export default async function AdminPage() {
  const isDbEnabled = dbEnabled();
  const adminData = await getAdminData();

  const nlValues = adminData.manualValues.filter((v) => v.itemType === "non_listed");
  const cashValues = adminData.manualValues.filter((v) => v.itemType === "cash");

  // Latest per asset
  const latestNL = new Map<string, typeof nlValues[number]>();
  for (const v of nlValues) {
    const ex = latestNL.get(v.itemKey);
    if (!ex || v.valueDate > ex.valueDate) latestNL.set(v.itemKey, v);
  }
  const latestCash = new Map<string, typeof cashValues[number]>();
  for (const v of cashValues) {
    const ex = latestCash.get(v.itemKey);
    if (!ex || v.valueDate > ex.valueDate) latestCash.set(v.itemKey, v);
  }

  const totalNL = [...latestNL.values()].reduce((s, r) => s + r.value, 0);
  const totalCash = [...latestCash.values()].reduce((s, r) => s + r.value, 0);
  const latestControl = adminData.controls[0];

  const sections = [
    {
      href: "/admin/dictionary",
      icon: Building2,
      title: "Asset Dictionary",
      description: "Manage registered assets",
      stat: `${adminData.dictionary.length} assets`,
      color: "text-primary",
      bgColor: "bg-primary/10",
      ok: adminData.dictionary.length > 0,
    },
    {
      href: "/admin/non-listed",
      icon: TrendingUp,
      title: "Non-Listed Values",
      description: "Enter monthly valuations",
      stat: latestNL.size > 0 ? formatEur(totalNL) : "No values",
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
      ok: latestNL.size > 0,
    },
    {
      href: "/admin/cash",
      icon: Wallet,
      title: "Cash & Liquidity",
      description: "Monthly balances for cash accounts",
      stat: latestCash.size > 0 ? formatEur(totalCash) : "No balances",
      color: "text-blue-400",
      bgColor: "bg-blue-500/10",
      ok: latestCash.size > 0,
    },
    {
      href: "/admin/controls",
      icon: Settings,
      title: "Portfolio Parameters",
      description: "Capital committed and reference values",
      stat: latestControl ? formatEur(latestControl.capitalCommitted) : "Not set",
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      ok: !!latestControl,
    },
  ];

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Portfolio data management · monthly value entry
        </p>
      </div>

      {/* DB status */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${
        isDbEnabled
          ? "bg-success/8 border-success/20 text-success"
          : "bg-warning/8 border-warning/20 text-warning"
      }`}>
        {isDbEnabled
          ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          : <Database className="w-4 h-4 shrink-0 mt-0.5" />
        }
        <div>
          <p className="font-semibold">
            {isDbEnabled ? "Database connected" : "Database not configured"}
          </p>
          <p className="text-xs mt-0.5 opacity-80">
            {isDbEnabled
              ? "All data entry modules are active."
              : "Add DATABASE_URL in .env.local to enable admin data saving."}
          </p>
        </div>
      </div>

      {/* Section cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sections.map(({ href, icon: Icon, title, description, stat, color, bgColor, ok }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-2xl border border-border/60 p-5 hover:border-border transition-all duration-200 hover:-translate-y-0.5"
            style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`p-2.5 rounded-xl ${bgColor} shrink-0`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors mt-0.5 shrink-0" />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className={`font-numeric text-base font-bold ${ok ? color : "text-muted-foreground"}`}>{stat}</p>
              {ok
                ? <CheckCircle2 className="w-4 h-4 text-success" />
                : <AlertCircle className="w-4 h-4 text-muted-foreground/40" />
              }
            </div>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      {adminData.manualValues.length > 0 && (
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-secondary/60">
              <List className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Recent Entries</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {adminData.manualValues.length} total
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Asset</th>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden sm:table-cell">Type</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Value</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
                </tr>
              </thead>
              <tbody>
                {adminData.manualValues.slice(0, 10).map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-foreground">{v.holdingName ?? v.displayName}</p>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${
                        v.itemType === "cash"
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                      }`}>
                        {v.itemType === "cash" ? "Cash" : "Non-Listed"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="font-numeric text-sm font-bold text-foreground">{formatEur(v.value)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-xs text-muted-foreground">{formatDate(v.valueDate)}</span>
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
