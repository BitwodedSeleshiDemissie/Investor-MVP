import { loadWorkbook } from "@/lib/excel-loader";
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
import { dbEnabled, query } from "@/db/client";
import { initSchema } from "@/db/schema";
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
  logger.info({ cutoff: data.cutoffDate }, "Workbook loaded");

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

  // Overlay cloud admin values if DB is connected
  if (dbEnabled()) {
    try {
      await initSchema();
      const cutoffStr = data.cutoffDate.toISOString().split("T")[0];
      const controls = await query<{ capital_committed: string }>(
        "SELECT capital_committed FROM admin_controls WHERE as_of_date <= $1 ORDER BY as_of_date DESC LIMIT 1",
        [cutoffStr]
      );
      if (controls.length > 0) {
        const cc = Number(controls[0].capital_committed);
        kpis.capitalCommitted = cc;
        kpis.pctSinceEntry = cc > 0 ? (kpis.totalPortfolioValue - cc) / cc : 0;
        kpis.moic = cc > 0 ? (kpis.totalPortfolioValue + kpis.totalIncome) / cc : 0;
      }

      const nlRows = await query<{ display_name: string; value: string }>(
        `SELECT DISTINCT ON (mv.item_key) mv.item_key, d.display_name, mv.value
         FROM admin_manual_values mv
         JOIN asset_dictionary d ON d.item_key = mv.item_key
         WHERE mv.as_of_date <= $1
           AND d.active = TRUE
           AND LOWER(d.item_type) <> 'cash'
           AND mv.item_key NOT ILIKE 'cash%'
         ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC`,
        [cutoffStr]
      );
      const nlTotal = nlRows.reduce((s, r) => s + Number(r.value), 0);
      if (nlTotal > 0) {
        composition.nonListed = nlTotal;
        composition.total = composition.listed + nlTotal + composition.cash;
      }

      const cashRows = await query<{ value: string }>(
        `SELECT DISTINCT ON (mv.item_key) mv.item_key, mv.value
         FROM admin_manual_values mv
         JOIN asset_dictionary d ON d.item_key = mv.item_key
         WHERE mv.as_of_date <= $1
           AND d.active = TRUE
           AND (LOWER(d.item_type) = 'cash' OR mv.item_key ILIKE 'cash%')
         ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC`,
        [cutoffStr]
      );
      const cashTotal = cashRows.reduce((s, r) => s + Number(r.value), 0);
      if (cashTotal > 0) {
        composition.cash = cashTotal;
        composition.total = composition.listed + composition.nonListed + cashTotal;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to overlay cloud admin values");
    }
  }

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
  const directaCash = pm(data, "Directa Cash", "Cash (Directa)", "Liquidity (Directa)");

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
    directaCash,
    cutoffDate: data.cutoffDate.toISOString().split("T")[0],
    investorName: env.INVESTOR_NAME,
    portfolioId: env.PORTFOLIO_ID,
    warnings,
  };
}
