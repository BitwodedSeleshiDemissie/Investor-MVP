import type { WorkbookData, TradeRow } from "./excel-loader";
import { INCOME_TYPES } from "./excel-loader";
import type {
  KPIs,
  NavPoint,
  AllocationSlice,
  IRRData,
  RiskMetrics,
  DistributionEvent,
  TargetVsActual,
  Holding,
  PortfolioComposition,
} from "@/types/portfolio";

interface Settings {
  riskFreeRate: number;
  moicTarget: number;
  targetEquityPct: number;
  targetBondPct: number;
  targetAltPct: number;
}

// Newton-Raphson XIRR implementation with light guardrails to match the Python portal.
export function xirrSafe(cashflows: { date: Date; amount: number }[]): number | null {
  if (cashflows.length < 2) return null;
  if (!cashflows.some((cf) => cf.amount < 0) || !cashflows.some((cf) => cf.amount > 0)) return null;
  const t0 = cashflows[0].date.getTime();
  const years = cashflows.map((cf) => (cf.date.getTime() - t0) / (365.25 * 24 * 3600 * 1000));
  const amounts = cashflows.map((cf) => cf.amount);

  function npv(rate: number): number {
    return amounts.reduce((acc, amt, i) => acc + amt / Math.pow(1 + rate, years[i]), 0);
  }
  function dnpv(rate: number): number {
    return amounts.reduce(
      (acc, amt, i) => acc - (amt * years[i]) / Math.pow(1 + rate, years[i] + 1),
      0
    );
  }

  for (const guess of [0.1, -0.1, 0.25, -0.5, 0.5]) {
    let rate = guess;
    for (let iter = 0; iter < 100; iter++) {
      const f = npv(rate);
      const df = dnpv(rate);
      if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-12) break;
      const newRate = rate - f / df;
      if (!Number.isFinite(newRate) || newRate <= -0.999999) break;
      if (Math.abs(newRate - rate) < 1e-8) return newRate;
      rate = newRate;
    }
  }
  return null;
}

function pm(data: WorkbookData, ...keys: string[]): number {
  for (const k of keys) {
    const v = data.portfolioMetrics[k];
    if (v !== undefined && v !== null && v !== "") return Number(v);
  }
  return 0;
}

function classifyAsset(assetClass: string): "equity" | "bonds" | "alts" | "cash" | "other" {
  const ac = assetClass.toLowerCase();
  if (ac.includes("etf") || ac.includes("etc") || ac.includes("crypto") || ac.includes("alternative") || ac.includes("fund") || ac.includes("private")) return "alts";
  if (ac.includes("stock") || ac.includes("equity")) return "equity";
  if (ac.includes("bond") || ac.includes("fixed") || ac.includes("coupon")) return "bonds";
  if (ac.includes("cash") || ac.includes("liquidity")) return "cash";
  return "other";
}

export function computeKPIs(data: WorkbookData, settings: Settings): KPIs {
  const nav = pm(data, "Total Portfolio Value", "NAV", "Portfolio Value");
  const committed = pm(data, "Capital Committed", "Total Invested Capital", "Committed Capital");

  // Total income: use pre-computed Portfolio Metrics value if available, else sum trade log
  const incomeRows = data.tradeLog.filter((r) => INCOME_TYPES.has(r.type));
  const tradeLogIncome = incomeRows.reduce((s, r) => s + r.netAmount, 0);
  const totalIncome = pm(data, "Total Income (Div+Cpn+Dist)", "Total Income", "Total Distributions");

  const pctSinceEntry = committed > 0 ? (nav - committed) / committed : 0;
  const moic = committed > 0 ? (nav + totalIncome) / committed : 0;
  const currentYield = nav > 0 ? totalIncome / nav : 0;

  const positiveDistributions = incomeRows.filter((r) => r.netAmount > 0);
  const distributions = positiveDistributions.sort((a, b) => b.date.getTime() - a.date.getTime());
  const lastDate = distributions.length > 0 ? distributions[0].date.toISOString().split("T")[0] : null;

  return {
    totalPortfolioValue: nav,
    capitalCommitted: committed,
    pctSinceEntry,
    moic,
    moicTarget: settings.moicTarget,
    currentYield,
    distributionsTotal: tradeLogIncome,
    distributionsCount: positiveDistributions.length,
    distributionsLastDate: lastDate,
    totalIncome,
  };
}

export function computeTimeseries(data: WorkbookData): NavPoint[] {
  if (data.monthlyReturns.length === 0) return [];
  const base = data.monthlyReturns[0].nav;
  return data.monthlyReturns.map((r) => {
    const normalized = r.cumulativeReturn !== undefined
      ? (1 + r.cumulativeReturn) * 100
      : base > 0 ? (r.nav / base) * 100 : 100;
    return {
      monthEnd: r.monthEnd.toISOString().split("T")[0],
      nav: r.nav,
      normalized,
      monthlyReturn: r.monthlyReturn,
      cumulativeReturn: r.cumulativeReturn ?? (base > 0 ? (r.nav - base) / base : 0),
    };
  });
}

export function computeAllocation(data: WorkbookData): AllocationSlice[] {
  const buckets: Record<string, number> = {};
  for (const h of data.holdings) {
    if (h.shares <= 0) continue;
    const label = normalizeAssetClass(h.assetClass);
    buckets[label] = (buckets[label] ?? 0) + h.marketValue;
  }
  const cashVal = pm(data, "Total Cash", "Cash Balance (est.)", "Cash", "Cash Total", "Liquidity");
  if (cashVal > 0) buckets["Cash"] = (buckets["Cash"] ?? 0) + cashVal;

  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  return Object.entries(buckets)
    .map(([assetClass, marketValue]) => ({
      assetClass,
      marketValue,
      weight: total > 0 ? marketValue / total : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);
}

function normalizeAssetClass(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("stock") || r.includes("equity")) return "Stocks";
  if (r.includes("bond") || r.includes("fixed income")) return "Bonds";
  if (r.includes("etf")) return "ETFs / ETCs";
  if (r.includes("etc")) return "ETFs / ETCs";
  if (r.includes("crypto")) return "Crypto ETPs";
  if (r.includes("cash") || r.includes("liquidity")) return "Cash";
  if (r.includes("fund") || r.includes("private")) return "Alternatives";
  return raw || "Other";
}

export function computeIRR(data: WorkbookData): IRRData {
  const nav = pm(data, "Total Portfolio Value", "NAV", "Portfolio Value");
  const valuationDate = data.cutoffDate.toISOString().split("T")[0];

  let investorIrr: number | null = null;
  let fundIrr: number | null = null;

  if (data.irrInvestor.length > 1) {
    const cfs = [
      ...data.irrInvestor.map((r) => ({ date: r.date, amount: r.cashFlow })),
      { date: data.cutoffDate, amount: nav },
    ];
    investorIrr = xirrSafe(cfs);
  }

  if (data.irrPortfolio.length > 1) {
    const listedNav = pm(data, "Listed Market Value", "Listed Value", "Total Portfolio Value");
    const cfs = [
      ...data.irrPortfolio.map((r) => ({ date: r.date, amount: r.cashFlow })),
      { date: data.cutoffDate, amount: listedNav },
    ];
    fundIrr = xirrSafe(cfs);
  }

  // Fall back to pre-computed values in portfolio metrics
  if (investorIrr === null) {
    const v = pm(data, "Investor IRR", "IRR Investor");
    if (v !== 0) investorIrr = v > 1 ? v / 100 : v;
  }
  if (fundIrr === null) {
    const v = pm(data, "Fund IRR", "Portfolio IRR", "Company IRR", "IRR Fund");
    if (v !== 0) fundIrr = v > 1 ? v / 100 : v;
  }

  return { fundIrr, investorIrr, valuationDate };
}

export function computeRisk(data: WorkbookData, settings: Settings): RiskMetrics {
  const returns = data.monthlyReturns.map((r) => r.monthlyReturn);
  const annReturn = pm(data, "Annualized Return (TWR)", "Annualized Return", "Ann. Return");

  const n = returns.length;
  if (n < 3) {
    return {
      sharpeRatio: 0,
      volatilityAnnualized: 0,
      maxDrawdown: 0,
      annualizedReturn: annReturn > 1 ? annReturn / 100 : annReturn,
      riskFreeRate: settings.riskFreeRate,
      dataWindowMonths: n,
      betaVsMsciWorld: null,
    };
  }

  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (n - 1);
  const volatilityAnnualized = Math.sqrt(variance * 12);

  const ar = annReturn > 1 ? annReturn / 100 : annReturn > 0 ? annReturn : mean * 12;
  const riskFreeRate = pm(data, "Risk-Free Rate (annual)") || settings.riskFreeRate;
  const sharpeRatio = volatilityAnnualized > 1e-12 ? (ar - riskFreeRate) / volatilityAnnualized : 0;

  // Max drawdown from compounded time-weighted return index, as in the Python portal.
  let maxDrawdown = 0;
  let index = 1;
  let peak = 1;
  for (const r of data.monthlyReturns) {
    index *= 1 + r.monthlyReturn;
    if (index > peak) peak = index;
    const dd = peak > 0 ? index / peak - 1 : 0;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  return {
    sharpeRatio,
    volatilityAnnualized,
    maxDrawdown,
    annualizedReturn: ar,
    riskFreeRate,
    dataWindowMonths: n,
    betaVsMsciWorld: null,
  };
}

export function computeDistributions(data: WorkbookData): DistributionEvent[] {
  return data.tradeLog
    .filter((r) => INCOME_TYPES.has(r.type))
    .map((r) => ({
      date: r.date.toISOString().split("T")[0],
      security: r.security,
      incomeType: r.type,
      amount: r.netAmount,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function computeTargets(data: WorkbookData, settings: Settings): TargetVsActual {
  const nav = pm(data, "Total Portfolio Value", "NAV", "Portfolio Value");
  const buckets = { equity: 0, bonds: 0, alts: 0, cash: 0 };
  for (const h of data.holdings) {
    if (h.shares <= 0) continue;
    const cls = classifyAsset(h.assetClass);
    if (cls === "equity") buckets.equity += h.marketValue;
    else if (cls === "bonds") buckets.bonds += h.marketValue;
    else if (cls === "alts") buckets.alts += h.marketValue;
  }
  buckets.cash = pm(data, "Total Cash", "Cash Balance (est.)", "Cash", "Cash Total", "Liquidity");
  const total = nav > 0 ? nav : Object.values(buckets).reduce((s, v) => s + v, 0);

  return {
    targetEquityPct: settings.targetEquityPct,
    targetBondPct: settings.targetBondPct,
    targetAltPct: settings.targetAltPct,
    currentEquityPct: total > 0 ? buckets.equity / total : 0,
    currentBondPct: total > 0 ? buckets.bonds / total : 0,
    currentAltPct: total > 0 ? buckets.alts / total : 0,
    currentCashPct: total > 0 ? buckets.cash / total : 0,
  };
}

export function computeHoldings(data: WorkbookData): Holding[] {
  return data.holdings.map((h) => ({
    security: h.security,
    assetClass: normalizeAssetClass(h.assetClass),
    currency: h.currency,
    shares: h.shares,
    avgCost: h.avgCost,
    costBasis: h.costBasis,
    currentPrice: h.currentPrice,
    marketValue: h.marketValue,
    unrealizedPnl: h.unrealizedPnl,
    pnlPct: h.pnlPct,
    weight: h.weight,
  }));
}

export function computeComposition(data: WorkbookData): PortfolioComposition {
  const listed = data.holdings
    .filter((h) => h.shares > 0 && !["private", "non-listed", "unlisted"].some((s) => h.assetClass.toLowerCase().includes(s)))
    .reduce((s, h) => s + h.marketValue, 0);
  const nonListed = pm(data, "Non-Listed Total", "Non-Listed Value", "Private Equity Total", "Total Non-Listed");
  const cash = pm(data, "Total Cash", "Cash Balance (est.)", "Directa Cash", "Cash", "Cash Total", "Liquidity");
  return { listed, nonListed, cash, total: listed + nonListed + cash };
}

export function checkWarnings(data: WorkbookData, tolerance = 0.005): string[] {
  const warnings: string[] = [];
  const reportedHoldings = pm(data, "Total Market Value (Holdings)");
  const holdingsTotal = data.holdings
    .filter((h) => h.shares > 0)
    .reduce((s, h) => s + h.marketValue, 0);
  if (reportedHoldings > 0 && holdingsTotal > 0) {
    const diff = Math.abs(reportedHoldings - holdingsTotal) / reportedHoldings;
    if (diff > tolerance) {
      warnings.push(
        `NAV_RECONCILIATION_MISMATCH: ${(diff * 100).toFixed(2)}% difference between holdings sum (${holdingsTotal.toFixed(0)}) and reported holdings value (${reportedHoldings.toFixed(0)})`
      );
    }
  }
  return warnings;
}
