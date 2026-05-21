import type { InvestorPerf } from "@/types/portfolio";
import { formatEur, formatPct, formatDate } from "@/lib/utils";
import { TermTooltip } from "@/components/ui/TermTooltip";
import { GLOSSARY } from "@/lib/glossary";

function formatMultiple(v: number): string {
  return `${v.toFixed(3)}x`;
}

export function InvestorPerformanceTable({ investors }: { investors: InvestorPerf[] }) {
  if (investors.length === 0) return null;

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
            {([
              { label: "Investor" },
              { label: "Type" },
              { label: "Entry Date" },
              { label: "Capital" },
              { label: "Years" },
              { label: "Current Value" },
              { label: "MOIC",    tooltip: GLOSSARY.moic },
              { label: "IRR",     tooltip: GLOSSARY.irrPerInvestor },
            ] as Array<{ label: string; tooltip?: string }>).map(({ label, tooltip }) => (
              <th key={label} className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest first:pl-4 last:pr-4">
                <div className="flex items-center gap-1">
                  {label}
                  {tooltip && <TermTooltip definition={tooltip} />}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {investors.map((inv) => {
            const irrColor = inv.irrAnnualized >= 0 ? "text-success" : "text-destructive";
            const moicColor = inv.moic >= 1 ? "text-success" : "text-destructive";
            return (
              <tr
                key={inv.name}
                className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors"
              >
                <td className="px-3 py-3 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="font-medium text-foreground text-sm">{inv.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className="px-2 py-0.5 rounded-full text-[11px] border bg-primary/10 text-primary border-primary/20">
                    {inv.type}
                  </span>
                </td>
                <td className="px-3 py-3 text-muted-foreground text-xs">{formatDate(inv.subscriptionDate)}</td>
                <td className="px-3 py-3 font-numeric font-semibold text-foreground">{formatEur(inv.capitalEur)}</td>
                <td className="px-3 py-3 text-muted-foreground text-xs">{inv.yearsElapsed.toFixed(2)}y</td>
                <td className="px-3 py-3 font-numeric font-semibold text-foreground">{formatEur(inv.currentValueEur)}</td>
                <td className={`px-3 py-3 font-numeric font-bold ${moicColor}`}>{formatMultiple(inv.moic)}</td>
                <td className={`px-3 py-3 pr-4 font-numeric font-bold ${irrColor}`}>{formatPct(inv.irrAnnualized)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
            <td className="px-3 py-2.5 pl-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider" colSpan={3}>
              Total / Fund
            </td>
            <td className="px-3 py-2.5 font-numeric font-bold text-foreground">
              {formatEur(investors.reduce((s, i) => s + i.capitalEur, 0))}
            </td>
            <td />
            <td className="px-3 py-2.5 font-numeric font-bold text-foreground">
              {formatEur(investors.reduce((s, i) => s + i.currentValueEur, 0))}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
