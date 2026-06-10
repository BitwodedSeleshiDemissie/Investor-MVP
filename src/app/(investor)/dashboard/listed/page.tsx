import { List } from "lucide-react";
import { redirect } from "next/navigation";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { HoldingsTable } from "@/components/dashboard/HoldingsTable";
import { cleanDisplayName, getSession } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section
      className="rounded-2xl border border-border/60 overflow-hidden"
      style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
        style={{ background: "hsl(222 44% 7%)" }}
      >
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
  const session = await getSession();
  if (!session) redirect("/login");
  const investorName = cleanDisplayName(session.investorName);
  if (session.role === "investor" && !investorName) redirect("/login");

  const snap = await getPortfolioSnapshot(session.role === "admin" ? undefined : investorName);
  const { holdings, cutoffDate } = snap;
  const positionsAsOf = snap.dataFreshness?.positionsAsOf ?? cutoffDate;

  const listed = holdings.filter(
    (h) => h.shares > 0 && !["private", "non-listed", "unlisted", "alternatives"].some(
      (s) => h.assetClass.toLowerCase().includes(s)
    )
  );
  const listedTotal = listed.reduce((s, h) => s + h.marketValue, 0);
  const byClass = Object.values(
    listed.reduce<Record<string, { assetClass: string; marketValue: number; weight: number }>>((acc, holding) => {
      acc[holding.assetClass] ??= { assetClass: holding.assetClass, marketValue: 0, weight: 0 };
      acc[holding.assetClass].marketValue += holding.marketValue;
      return acc;
    }, {})
  )
    .map((item) => ({
      ...item,
      weight: listedTotal > 0 ? item.marketValue / listedTotal : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return (
    <div className="space-y-5 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Listed / Market-Priced</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Market-priced assets as of {formatDate(positionsAsOf)}
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 p-6 bg-secondary/20">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Breakdown by Type</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {byClass.slice(0, 5).map((a) => (
            <div key={a.assetClass} className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/40 px-3 py-2.5">
              <span className="text-xs text-muted-foreground truncate">{a.assetClass}</span>
              <span className="font-numeric text-xs font-semibold text-foreground shrink-0">
                {(a.weight * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <Section title="Listed Holdings" icon={List}>
        <HoldingsTable holdings={listed} />
      </Section>
    </div>
  );
}
