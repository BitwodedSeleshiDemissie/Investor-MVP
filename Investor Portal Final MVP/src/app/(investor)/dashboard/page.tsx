import {
  TrendingUp, Wallet, Percent, DollarSign, Calendar,
  Activity, PieChart, Target, List, LayoutDashboard, AlertTriangle,
  BarChart3, type LucideIcon,
} from "lucide-react";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { KPICard } from "@/components/dashboard/KPICard";
import { NavChart } from "@/components/dashboard/NavChart";
import { AllocationChart } from "@/components/dashboard/AllocationChart";
import { PortfolioCompositionBlock } from "@/components/dashboard/PortfolioComposition";
import { RiskMetricsBlock } from "@/components/dashboard/RiskMetrics";
import { IRRAnalysis } from "@/components/dashboard/IRRAnalysis";
import { TargetVsActualChart } from "@/components/dashboard/TargetVsActual";
import { DistributionsTable } from "@/components/dashboard/DistributionsTable";
import { HoldingsTable } from "@/components/dashboard/HoldingsTable";
import { formatEur, formatPct, formatMultiple, formatDate } from "@/lib/utils";

function Section({
  title, icon: Icon, children, id, action,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  id?: string;
  action?: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-2xl border border-border/60 overflow-hidden"
      style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/60"
        style={{ background: "hsl(222 44% 7%)" }}>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default async function DashboardPage() {
  const snap = await getPortfolioSnapshot();
  const { kpis, irr, risk, allocation, timeseries, distributions, targets, holdings, composition, pnl, warnings } = snap;

  type SubColor = "positive" | "negative" | "neutral";
  type Variant  = "default" | "primary" | "success" | "warning";

  const kpiCards: Array<{
    title: string; value: string; subvalue?: string;
    subvalueColor?: SubColor; icon: LucideIcon; variant: Variant;
  }> = [
    {
      title: "Portfolio Value",
      value: formatEur(kpis.totalPortfolioValue),
      subvalue: formatPct(kpis.pctSinceEntry) + " since entry",
      subvalueColor: kpis.pctSinceEntry >= 0 ? "positive" : "negative",
      icon: Wallet,
      variant: "primary",
    },
    {
      title: "Capital Committed",
      value: formatEur(kpis.capitalCommitted),
      icon: DollarSign,
      variant: "default",
    },
    {
      title: "MOIC",
      value: formatMultiple(kpis.moic),
      subvalue: `Target ${formatMultiple(kpis.moicTarget)}`,
      subvalueColor: kpis.moic >= kpis.moicTarget ? "positive" : "neutral",
      icon: TrendingUp,
      variant: kpis.moic >= kpis.moicTarget ? "success" : "default",
    },
    {
      title: "Investor IRR",
      value: irr.investorIrr != null ? formatPct(irr.investorIrr) : "—",
      subvalue: `Fund IRR: ${irr.fundIrr != null ? formatPct(irr.fundIrr) : "—"}`,
      icon: Activity,
      variant: "default",
    },
    {
      title: "Current Yield",
      value: formatPct(kpis.currentYield),
      subvalue: "TTM income / NAV",
      icon: Percent,
      variant: "default",
    },
    {
      title: "Total Income",
      value: formatEur(kpis.distributionsTotal),
      subvalue: kpis.distributionsLastDate
        ? `Last: ${formatDate(kpis.distributionsLastDate)}`
        : undefined,
      icon: Calendar,
      variant: "success",
    },
  ];

  return (
    <div className="space-y-5 pb-10 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-1 pb-1">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Portfolio Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {snap.investorName}
            <span className="mx-1.5 text-border">·</span>
            {snap.portfolioId}
            <span className="mx-1.5 text-border">·</span>
            As of <span className="text-foreground font-medium">{formatDate(snap.cutoffDate)}</span>
          </p>
        </div>
      </div>

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-warning/8 border border-warning/20 text-warning text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* ── KPI grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map((card) => (
          <KPICard key={card.title} {...card} />
        ))}
      </div>

      {/* ── Composition ── */}
      <Section title="Portfolio Composition" icon={LayoutDashboard}>
        <PortfolioCompositionBlock composition={composition} />
      </Section>

      {/* ── NAV + Allocation (2/3 + 1/3) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" id="performance">
        <div className="lg:col-span-2">
          <Section title="Portfolio Value Over Time" icon={TrendingUp}>
            <div className="pt-1">
              <div className="flex items-end gap-4 mb-4">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Current NAV</p>
                  <p className="font-numeric text-2xl font-bold text-foreground">{formatEur(kpis.totalPortfolioValue)}</p>
                </div>
                <div className="pb-0.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cumulative TWR</p>
                  <p className={`font-numeric text-lg font-bold ${kpis.pctSinceEntry >= 0 ? "text-success" : "text-destructive"}`}>
                    {formatPct(kpis.pctSinceEntry)}
                  </p>
                </div>
              </div>
              <NavChart data={timeseries} />
            </div>
          </Section>
        </div>

        <div id="allocation">
          <Section title="Current Allocation" icon={PieChart}>
            <AllocationChart data={allocation} />
          </Section>
        </div>
      </div>

      {/* ── IRR + P&L (full width) ── */}
      <Section title="IRR & P&L Analysis" icon={BarChart3}>
        <IRRAnalysis irr={irr} pnl={pnl} />
      </Section>

      {/* ── Risk + Target (side-by-side) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Risk Metrics" icon={Activity}>
          <RiskMetricsBlock risk={risk} />
        </Section>
        <Section title="Target vs Actual Allocation" icon={Target}>
          <TargetVsActualChart targets={targets} />
        </Section>
      </div>

      {/* ── Distributions ── */}
      <Section title="Income &amp; Distributions" icon={Calendar}>
        <DistributionsTable distributions={distributions} />
      </Section>

      {/* ── Holdings ── */}
      <Section title="Holdings" icon={List} id="holdings">
        <HoldingsTable holdings={holdings} />
      </Section>
    </div>
  );
}
