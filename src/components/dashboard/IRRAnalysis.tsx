import type { IRRData, PnLBreakdown } from "@/types/portfolio";
import { formatPctPlain, formatDate, formatEur, pnlColor } from "@/lib/utils";
import { TrendingUp, BarChart3, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface IRRAnalysisProps {
  irr: IRRData;
  pnl: PnLBreakdown;
}

export function IRRAnalysis({ irr, pnl }: IRRAnalysisProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left: IRR cards */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Internal Rate of Return</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-primary/20 p-5 flex flex-col gap-3"
            style={{ background: "hsl(26 90% 54% / 0.07)" }}>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/15">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
              </div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Investor IRR</p>
            </div>
            <p className="font-numeric text-4xl font-bold text-gradient-gold leading-none">
              {irr.investorIrr != null ? formatPctPlain(irr.investorIrr) : "—"}
            </p>
            <p className="text-xs text-muted-foreground leading-tight">Effective return on cash flows</p>
          </div>

          <div className="rounded-xl border border-border/60 p-5 flex flex-col gap-3 bg-secondary/20">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-secondary/80">
                <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Fund IRR</p>
            </div>
            <p className="font-numeric text-4xl font-bold text-foreground leading-none">
              {irr.fundIrr != null ? formatPctPlain(irr.fundIrr) : "—"}
            </p>
            <p className="text-xs text-muted-foreground leading-tight">On the listed and priced portfolio</p>
          </div>

          <div className="rounded-xl border border-border/60 p-5 flex flex-col gap-3 bg-secondary/20">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-secondary/80">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Valuation Date</p>
            </div>
            <p className="font-numeric text-xl font-bold text-foreground leading-none mt-1">{formatDate(irr.valuationDate)}</p>
            <p className="text-xs text-muted-foreground leading-tight">NAV valuation reference</p>
          </div>
        </div>
      </div>

      {/* Right: P&L breakdown */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">P&amp;L Breakdown</p>
        <div className="rounded-xl border border-border/60 overflow-hidden">
          {[
            { label: "Unrealized P&L", value: pnl.unrealized, note: "On open positions" },
            { label: "Realized P&L",   value: pnl.realized,   note: "From closed positions" },
            { label: "Net Total P&L",  value: pnl.netTotal,   note: "Overall total", bold: true },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              className={cn(
                "flex items-center justify-between px-5 py-4",
                i < arr.length - 1 ? "border-b border-border/60" : "",
                row.bold ? "bg-secondary/20" : ""
              )}
            >
              <div>
                <p className={cn("text-sm", row.bold ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {row.label}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">{row.note}</p>
              </div>
              <p className={cn(
                "font-numeric font-bold",
                row.bold ? "text-xl" : "text-base",
                pnlColor(row.value)
              )}>
                {row.value !== 0 ? formatEur(row.value) : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
