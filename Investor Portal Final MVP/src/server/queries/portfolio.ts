import { loadWorkbook } from "@/lib/excel-loader";
import type { InvestorPerf } from "@/types/portfolio";
import {
  computeKPIs,
  computeTimeseries,
  computeAllocation,
  computeIRR,
  computeRisk,
  computeDistributions,
  computeTargets,
  computeHoldings,
  computeComposition,
  checkWarnings,
} from "@/lib/calculations";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { PortfolioSnapshot } from "@/types/portfolio";

const settings = {
  riskFreeRate: env.RISK_FREE_RATE,
  moicTarget: env.MOIC_TARGET,
  targetEquityPct: env.TARGET_EQUITY_PCT,
  targetBondPct: env.TARGET_BOND_PCT,
  targetAltPct: env.TARGET_ALT_PCT,
};

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const data = loadWorkbook(env.EXCEL_PATH);
  logger.info({ cutoff: data.cutoffDate }, "Tracker loaded");

  const [kpis, timeseries, allocation, irr, risk, distributions, targets, holdings, composition, warnings] =
    await Promise.all([
      Promise.resolve(computeKPIs(data, settings)),
      Promise.resolve(computeTimeseries(data)),
      Promise.resolve(computeAllocation(data)),
      Promise.resolve(computeIRR(data)),
      Promise.resolve(computeRisk(data, settings)),
      Promise.resolve(computeDistributions(data)),
      Promise.resolve(computeTargets(data, settings)),
      Promise.resolve(computeHoldings(data)),
      Promise.resolve(computeComposition(data)),
      Promise.resolve(checkWarnings(data)),
    ]);

  function pm(d: typeof data, ...keys: string[]): number {
    for (const k of keys) {
      const v = d.portfolioMetrics[k];
      if (v !== undefined && v !== null) return Number(v);
    }
    return 0;
  }

  const pnl = {
    unrealized: pm(data, "Unrealized P&L", "Total Unrealized P&L"),
    realized:   pm(data, "Realized P&L",   "Total Realized P&L"),
    netTotal:   pm(data, "Net Total P&L",  "Net P&L"),
  };

  const investorPerformance: InvestorPerf[] = data.investorPerformance.map((p) => ({
    name: p.name,
    type: p.type,
    subscriptionDate: p.subscriptionDate.toISOString().split("T")[0],
    capitalEur: p.capitalEur,
    units: p.units,
    yearsElapsed: p.yearsElapsed,
    navUnitAtSub: p.navUnitAtSub,
    currentValueEur: p.currentValueEur,
    moic: p.moic,
    irrAnnualized: p.irrAnnualized,
  }));

  return {
    kpis,
    timeseries,
    allocation,
    irr,
    risk,
    distributions,
    targets,
    holdings,
    composition,
    pnl,
    directaCash: pm(data, "Total Cash", "Cash", "Liquidity"),
    cutoffDate: data.cutoffDate.toISOString().split("T")[0],
    investorName: env.INVESTOR_NAME,
    portfolioId: env.PORTFOLIO_ID,
    warnings,
    investorPerformance,
  };
}
