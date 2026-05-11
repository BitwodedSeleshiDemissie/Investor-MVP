import type { DistributionEvent } from "@/types/portfolio";
import { formatEur, formatDate } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  Dividend:      "bg-primary/10 text-primary border-primary/20",
  Coupon:        "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Distribution:  "bg-success/10 text-success border-success/20",
  "Sec. Lending": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Income:        "bg-warning/10 text-warning border-warning/20",
};

function badge(type: string) {
  return TYPE_COLORS[type] ?? "bg-secondary text-muted-foreground border-border";
}

export function DistributionsTable({ distributions }: { distributions: DistributionEvent[] }) {
  if (!distributions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">💰</span>
        <p className="text-sm">No distributions recorded</p>
      </div>
    );
  }

  const total = distributions.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="space-y-1">
      {/* Total pill */}
      <div className="flex justify-end mb-3">
        <div className="px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-success text-xs font-semibold font-numeric">
          Total: {formatEur(total)}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Date</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Security</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden sm:table-cell">Type</th>
              <th className="text-right px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Amount</th>
            </tr>
          </thead>
          <tbody>
            {distributions.map((d, i) => (
              <tr key={i}
                className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors">
                <td className="px-4 py-3 text-xs text-muted-foreground font-numeric whitespace-nowrap">
                  {formatDate(d.date)}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-foreground max-w-[180px] truncate">
                  {d.security}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge(d.incomeType)}`}>
                    {d.incomeType}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-numeric font-semibold text-success text-sm">
                  {formatEur(d.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
