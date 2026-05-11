import { dbEnabled, query } from "@/db/client";
import { initSchema } from "@/db/schema";
import { env } from "@/lib/env";
import type {
  AllocationSlice,
  DistributionEvent,
  Holding,
  IRRData,
  KPIs,
  NavPoint,
  PnLBreakdown,
  PortfolioComposition,
  PortfolioSnapshot,
  RiskMetrics,
  TargetVsActual,
} from "@/types/portfolio";

const settings = {
  riskFreeRate: env.RISK_FREE_RATE,
  moicTarget: env.MOIC_TARGET,
  targetEquityPct: env.TARGET_EQUITY_PCT,
  targetBondPct: env.TARGET_BOND_PCT,
  targetAltPct: env.TARGET_ALT_PCT,
};

type ControlRow = {
  portfolio_id: string;
  investor_name: string;
  as_of_date: string;
  capital_committed: string;
};

type ManualSummaryRow = {
  item_key: string;
  display_name: string;
  item_type: string;
  subcategory: string | null;
  currency: string;
  as_of_date: string;
  value: string;
};

function toDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return value.includes("T") ? value.split("T")[0] : value;
}

function normalizeType(itemType: string): "cash" | "non_listed" {
  return itemType.toLowerCase() === "cash" ? "cash" : "non_listed";
}

function allocationFromComposition(composition: PortfolioComposition): AllocationSlice[] {
  const rows = [
    { assetClass: "Listed / Market-Priced", marketValue: composition.listed },
    { assetClass: "Non-Listed", marketValue: composition.nonListed },
    { assetClass: "Cash", marketValue: composition.cash },
  ].filter((row) => row.marketValue > 0);

  return rows.map((row) => ({
    ...row,
    weight: composition.total > 0 ? row.marketValue / composition.total : 0,
  }));
}

function targetsFromComposition(composition: PortfolioComposition): TargetVsActual {
  const total = composition.total;
  return {
    targetEquityPct: settings.targetEquityPct,
    targetBondPct: settings.targetBondPct,
    targetAltPct: settings.targetAltPct,
    currentEquityPct: total > 0 ? composition.listed / total : 0,
    currentBondPct: 0,
    currentAltPct: total > 0 ? composition.nonListed / total : 0,
    currentCashPct: total > 0 ? composition.cash / total : 0,
  };
}

function emptyRisk(): RiskMetrics {
  return {
    sharpeRatio: 0,
    volatilityAnnualized: 0,
    maxDrawdown: 0,
    annualizedReturn: 0,
    riskFreeRate: settings.riskFreeRate,
    dataWindowMonths: 0,
  };
}

function emptyPnL(): PnLBreakdown {
  return { unrealized: 0, realized: 0, netTotal: 0 };
}

function emptyIrr(cutoffDate: string): IRRData {
  return { fundIrr: null, investorIrr: null, valuationDate: cutoffDate };
}

function buildKpis(composition: PortfolioComposition, capitalCommitted: number): KPIs {
  const totalIncome = 0;
  return {
    totalPortfolioValue: composition.total,
    capitalCommitted,
    pctSinceEntry: capitalCommitted > 0 ? (composition.total - capitalCommitted) / capitalCommitted : 0,
    moic: capitalCommitted > 0 ? (composition.total + totalIncome) / capitalCommitted : 0,
    moicTarget: settings.moicTarget,
    currentYield: composition.total > 0 ? totalIncome / composition.total : 0,
    distributionsTotal: totalIncome,
    distributionsCount: 0,
    distributionsLastDate: null,
    totalIncome,
  };
}

async function latestDataDate(): Promise<string | null> {
  const rows = await query<{ cutoff_date: string | null }>(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(as_of_date) FROM admin_controls), DATE '1900-01-01'),
       COALESCE((SELECT MAX(as_of_date) FROM admin_manual_values), DATE '1900-01-01')
     )::text AS cutoff_date`
  );
  const value = rows[0]?.cutoff_date;
  return value && value !== "1900-01-01" ? toDateOnly(value) : null;
}

async function latestControl(cutoffDate: string): Promise<ControlRow | null> {
  const rows = await query<ControlRow>(
    `SELECT portfolio_id, investor_name, as_of_date, capital_committed
     FROM admin_controls
     WHERE as_of_date <= $1
     ORDER BY as_of_date DESC, created_at DESC
     LIMIT 1`,
    [cutoffDate]
  );
  return rows[0] ?? null;
}

async function latestManualRows(cutoffDate: string): Promise<ManualSummaryRow[]> {
  return query<ManualSummaryRow>(
    `WITH picked AS (
       SELECT DISTINCT ON (mv.item_key)
         mv.item_key,
         mv.as_of_date,
         mv.value,
         mv.currency
       FROM admin_manual_values mv
       WHERE mv.as_of_date <= $1
       ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
     )
     SELECT
       p.item_key,
       d.display_name,
       d.item_type,
       d.subcategory,
       COALESCE(NULLIF(p.currency, ''), d.currency, 'EUR') AS currency,
       p.as_of_date,
       p.value
     FROM picked p
     JOIN asset_dictionary d ON d.item_key = p.item_key
     WHERE d.active = TRUE
     ORDER BY d.sort_order, d.item_key`,
    [cutoffDate]
  );
}

function holdingsFromManualRows(rows: ManualSummaryRow[], total: number): Holding[] {
  return rows.map((row) => {
    const value = Number(row.value);
    return {
      security: row.display_name,
      assetClass: normalizeType(row.item_type) === "cash" ? "Cash" : row.subcategory || "Non-Listed",
      currency: row.currency || "EUR",
      shares: 1,
      avgCost: value,
      costBasis: value,
      currentPrice: value,
      marketValue: value,
      unrealizedPnl: 0,
      pnlPct: 0,
      weight: total > 0 ? value / total : 0,
    };
  });
}

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  if (!dbEnabled()) {
    throw new Error("Database not configured. Set DATABASE_URL to read the Render portfolio data.");
  }

  await initSchema();

  const cutoffDate = (await latestDataDate()) ?? new Date().toISOString().split("T")[0];
  const control = await latestControl(cutoffDate);
  const manualRows = await latestManualRows(cutoffDate);

  const totals = manualRows.reduce(
    (acc, row) => {
      const value = Number(row.value);
      if (normalizeType(row.item_type) === "cash") acc.cash += value;
      else acc.nonListed += value;
      return acc;
    },
    { cash: 0, nonListed: 0 }
  );

  const composition: PortfolioComposition = {
    listed: 0,
    nonListed: totals.nonListed,
    cash: totals.cash,
    total: totals.nonListed + totals.cash,
  };

  const capitalCommitted = control ? Number(control.capital_committed) : 0;
  const holdings = holdingsFromManualRows(manualRows, composition.total);
  const warnings =
    composition.total > 0
      ? ["Listed-market data is not present in Render yet; dashboard totals currently reflect admin-entered non-listed and cash values."]
      : ["No Render portfolio values have been entered yet."];

  return {
    kpis: buildKpis(composition, capitalCommitted),
    timeseries: [] as NavPoint[],
    allocation: allocationFromComposition(composition),
    irr: emptyIrr(cutoffDate),
    risk: emptyRisk(),
    distributions: [] as DistributionEvent[],
    targets: targetsFromComposition(composition),
    holdings,
    composition,
    pnl: emptyPnL(),
    directaCash: 0,
    cutoffDate,
    investorName: control?.investor_name || env.INVESTOR_NAME,
    portfolioId: control?.portfolio_id || env.PORTFOLIO_ID,
    warnings,
  };
}
