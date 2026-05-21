export const dynamic = "force-dynamic";

import {
  Activity,
  AlertTriangle,
  DollarSign,
  LayoutDashboard,
  PieChart,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { redirect } from "next/navigation";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { cleanDisplayName, getSession } from "@/lib/auth";
import { KPICard } from "@/components/dashboard/KPICard";
import { AllocationChart } from "@/components/dashboard/AllocationChart";
import { PortfolioCompositionBlock } from "@/components/dashboard/PortfolioComposition";
import { RiskMetricsBlock } from "@/components/dashboard/RiskMetrics";
import { InvestorPerformanceTable } from "@/components/dashboard/InvestorPerformanceTable";
import { formatEur, formatPct, formatMultiple, formatDate } from "@/lib/utils";
import { GLOSSARY } from "@/lib/glossary";

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
    <section
      id={id}
      className="rounded-2xl border border-border/60 overflow-hidden"
      style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="flex items-center justify-between px-5 py-4 border-b border-border/60"
        style={{ background: "hsl(222 44% 7%)" }}
      >
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
  const session = await getSession();

  if (session?.role === "investor" && !session.investorName) {
    redirect("/login");
  }

  const sessionInvestorName = cleanDisplayName(session?.investorName);
  const snap = await getPortfolioSnapshot(sessionInvestorName);
  const { kpis, irr, risk, allocation, composition, warnings } = snap;
  const performanceRows = snap.investorPerformance ?? [];

  const investorPerformance =
    session?.role === "admin"
      ? performanceRows
      : performanceRows.filter(
          (p) => !sessionInvestorName || p.name.toLowerCase() === sessionInvestorName.toLowerCase()
        );

  type SubColor = "positive" | "negative" | "neutral";
  type Variant = "default" | "primary" | "success" | "warning";

  const kpiCards: Array<{
    title: string;
    value: string;
    subvalue?: string;
    subvalueColor?: SubColor;
    icon: LucideIcon;
    variant: Variant;
    tooltip?: string;
  }> = [
    {
      title: "Portfolio Value",
      value: formatEur(kpis.totalPortfolioValue),
      subvalue: formatPct(kpis.pctSinceEntry) + " since entry",
      subvalueColor: kpis.pctSinceEntry >= 0 ? "positive" : "negative",
      icon: Wallet,
      variant: "primary",
      tooltip: GLOSSARY.portfolioValue,
    },
    {
      title: "Capital Committed",
      value: formatEur(kpis.capitalCommitted),
      icon: DollarSign,
      variant: "default",
      tooltip: GLOSSARY.capitalCommitted,
    },
    {
      title: "MOIC",
      value: formatMultiple(kpis.moic),
      subvalue: `Target ${formatMultiple(kpis.moicTarget)}`,
      subvalueColor: kpis.moic >= kpis.moicTarget ? "positive" : "neutral",
      icon: TrendingUp,
      variant: kpis.moic >= kpis.moicTarget ? "success" : "default",
      tooltip: GLOSSARY.moic,
    },
    {
      title: "Investor IRR",
      value: irr.investorIrr != null ? formatPct(irr.investorIrr) : "-",
      subvalue: `Fund IRR: ${irr.fundIrr != null ? formatPct(irr.fundIrr) : "-"}`,
      icon: Activity,
      variant: "default",
      tooltip: GLOSSARY.investorIrr,
    },
  ];

  return (
    <div className="space-y-5 pb-10 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-1 pb-1">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Portfolio Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {snap.investorName}
            <span className="mx-1.5 text-border">/</span>
            {snap.portfolioId}
            <span className="mx-1.5 text-border">/</span>
            As of <span className="text-foreground font-medium">{formatDate(snap.cutoffDate)}</span>
          </p>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-warning/8 border border-warning/20 text-warning text-xs font-medium"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((card) => (
          <KPICard key={card.title} {...card} />
        ))}
      </div>

      <Section title="Portfolio Composition" icon={LayoutDashboard}>
        <PortfolioCompositionBlock composition={composition} />
      </Section>

      <div id="allocation">
        <Section title="Current Allocation" icon={PieChart}>
          <AllocationChart data={allocation} />
        </Section>
      </div>

      <Section title="Risk Metrics" icon={Activity}>
        <RiskMetricsBlock risk={risk} />
      </Section>

      {investorPerformance.length > 0 && (
        <Section title="Investor Performance" icon={Users}>
          <p className="text-xs text-muted-foreground mb-4">
            IRR is annualized per investor and differs based on entry date.
          </p>
          <InvestorPerformanceTable investors={investorPerformance} />
        </Section>
      )}
    </div>
  );
}
