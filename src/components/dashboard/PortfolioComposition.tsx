import type { PortfolioComposition } from "@/types/portfolio";
import { formatEur } from "@/lib/utils";

const SLICES = [
  { key: "listed",    label: "Listed / Market-Priced",   color: "hsl(26 90% 54%)",   bg: "bg-primary/10",   text: "text-primary" },
  { key: "nonListed", label: "Non-Listed / Approved",    color: "hsl(150 60% 40%)",  bg: "bg-success/10",   text: "text-success" },
  { key: "cash",      label: "Cash & Liquidity",          color: "hsl(217 91% 62%)",  bg: "bg-blue-500/10",  text: "text-blue-400" },
] as const;

export function PortfolioCompositionBlock({ composition }: { composition: PortfolioComposition }) {
  const total = composition.total || 1;
  const activeSlices = SLICES.filter((s) => composition[s.key] > 0);

  return (
    <div className="space-y-5">
      {/* Stacked progress bar */}
      <div className="relative h-2.5 rounded-full overflow-hidden bg-secondary/50 flex gap-px">
        {activeSlices.map((s) => (
          <div
            key={s.key}
            className="h-full transition-all duration-500"
            style={{
              width: `${(composition[s.key] / total) * 100}%`,
              background: s.color,
            }}
          />
        ))}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {activeSlices.map((s) => {
          const pct = ((composition[s.key] / total) * 100).toFixed(1);
          return (
            <div key={s.key}
              className="rounded-xl border border-border/60 p-4 bg-secondary/20 hover:bg-secondary/30 transition-colors">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">
                  {s.label}
                </p>
              </div>
              <p className={`font-numeric text-xl font-bold ${s.text}`}>{formatEur(composition[s.key])}</p>
              <p className="text-xs text-muted-foreground mt-1">{pct}% of total</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
