import type { RiskMetrics } from "@/types/portfolio";
import { formatPctPlain } from "@/lib/utils";
import { cn } from "@/lib/utils";

function RiskTile({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "good" | "bad" | "info";
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 hover:bg-secondary/30 transition-colors">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{label}</p>
      <p className={cn(
        "font-numeric text-2xl font-bold leading-none mb-2",
        tone === "good"    && "text-success",
        tone === "bad"     && "text-destructive",
        tone === "info"    && "text-primary",
        tone === "neutral" && "text-foreground",
      )}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground leading-tight">{note}</p>
    </div>
  );
}

export function RiskMetricsBlock({ risk }: { risk: RiskMetrics }) {
  const sharpe = risk.sharpeRatio;
  const sharpeTone = sharpe > 1 ? "good" : sharpe < 0 ? "bad" : "neutral";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <RiskTile
        label="Sharpe Ratio"
        value={sharpe.toFixed(2)}
        note="Risk-adjusted return"
        tone={sharpeTone}
      />
      <RiskTile
        label="Ann. Volatility"
        value={formatPctPlain(risk.volatilityAnnualized)}
        note="Std dev × √12"
        tone="neutral"
      />
      <RiskTile
        label="Max Drawdown"
        value={formatPctPlain(risk.maxDrawdown)}
        note="Max loss from peak"
        tone={risk.maxDrawdown < -0.1 ? "bad" : "neutral"}
      />
      <RiskTile
        label="Ann. Return"
        value={formatPctPlain(risk.annualizedReturn)}
        note="Annualized TWR"
        tone={risk.annualizedReturn > 0 ? "good" : "bad"}
      />
      <RiskTile
        label="Risk-Free Rate"
        value={formatPctPlain(risk.riskFreeRate)}
        note="Risk-free benchmark"
        tone="info"
      />
      <RiskTile
        label="Data Window"
        value={`${risk.dataWindowMonths} months`}
        note="Sample window"
        tone="neutral"
      />
    </div>
  );
}
