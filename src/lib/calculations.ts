import type { WorkbookData } from "./excel-loader";
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

function pmIrr(data: WorkbookData, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = data.portfolioMetrics[k];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    return Math.abs(n) > 1 ? n / 100 : n;
  }
  return null;
}

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function hasTerminalValue(
  cashflows: { date: Date; amount: number }[],
  cutoffDate: Date,
  nav: number
): boolean {
  if (nav <= 0) return false;
  const cutoff = dateKey(cutoffDate);
  return cashflows.some((cf) => {
    if (dateKey(cf.date) !== cutoff || cf.amount <= 0) return false;
    return Math.abs(cf.amount - nav) / nav <= 0.01;
  });
}

function classifyAsset(assetClass: string): "equity" | "bonds" | "alts" | "cash" | "other" {
  const ac = assetClass.toLowerCase();
  if (ac.includes("stock") || ac.includes("equity")) return "equity";
  if (ac.includes("bond") || ac.includes("fixed") || ac.includes("coupon")) return "bonds";
  // ETF/ETC and Crypto belong in the alternatives bucket (matches Python reference compute_targets)
  if (ac.includes("etf") || ac.includes("etc") || ac.includes("crypto") || ac.includes("alternative") || ac.includes("etp")) return "alts";
  if (ac.includes("cash") || ac.includes("liquidity")) return "cash";
  return "other";
}

export function computeKPIs(data: WorkbookData, settings: Settings): KPIs {
  const nav = pm(data, "Total Portfolio Value", "NAV", "Portfolio Value");
  const committed = pm(data, "Capital Committed", "Total Invested Capital", "Committed Capital");

  const pmIncome = pm(data, "Total Income (Div+Cpn+Dist)", "Total Income", "Total Distributions");
  const incomeRows = data.tradeLog.filter((r) => INCOME_TYPES.has(r.type));
  const tradeLogIncome = incomeRows.reduce((s, r) => s + r.netAmount, 0);
  const totalIncome = pmIncome > 0 ? pmIncome : Math.abs(tradeLogIncome);

  const pctSinceEntry = committed > 0 ? (nav - committed) / committed : 0;

  // MOIC = (NAV + total income received) / capital_committed
  // Distributed income has left the portfolio, so must be added back (matches CEO reference)
  const moic = committed > 0 ? (nav + totalIncome) / committed : 0;

  const currentYield = nav > 0 ? totalIncome / nav : 0;

  const positiveIncomeRows = incomeRows.filter((r) => r.netAmount > 0);
  const lastDate =
    positiveIncomeRows.length > 0
      ? dateKey(positiveIncomeRows.sort((a, b) => b.date.getTime() - a.date.getTime())[0].date)
      : null;

  return {
    totalPortfolioValue: nav,
    capitalCommitted: committed,
    pctSinceEntry,
    moic,
    moicTarget: settings.moicTarget,
    currentYield,
    distributionsTotal: totalIncome,
    distributionsCount: positiveIncomeRows.length,
    distributionsLastDate: lastDate,
    totalIncome,
  };
}

export function computeTimeseries(data: WorkbookData): NavPoint[] {
  if (data.monthlyReturns.length === 0) return [];
  // TWR-based index: compound monthly returns so deposits/withdrawals don't distort the series.
  // normalized[0] = 100 by definition; normalized[i] = normalized[i-1] * (1 + r_i).
  let normalizedIdx = 100;
  return data.monthlyReturns.map((r, i) => {
    if (i > 0) normalizedIdx *= (1 + r.monthlyReturn);
    return {
      monthEnd: dateKey(r.monthEnd),
      nav: r.nav,
      normalized: normalizedIdx,
      monthlyReturn: r.monthlyReturn,
      cumulativeReturn: (normalizedIdx - 100) / 100,
    };
  });
}

function normalizeAssetClass(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("stock") || r.includes("equity")) return "Stocks";
  if (r.includes("bond") || r.includes("fixed income")) return "Bonds";
  if (r.includes("etf") || r.includes("etc")) return "ETFs / ETCs";
  if (r.includes("crypto") || r.includes("etp")) return "Crypto ETPs";
  if (r.includes("cash") || r.includes("liquidity")) return "Cash";
  if (r.includes("fund") || r.includes("private") || r.includes("alternative")) return "Alternatives";
  return raw || "Other";
}

export function computeAllocation(data: WorkbookData): AllocationSlice[] {
  const buckets: Record<string, number> = {};

  for (const h of data.holdings) {
    if (h.shares <= 0) continue;
    const label = normalizeAssetClass(h.assetClass);
    buckets[label] = (buckets[label] ?? 0) + h.marketValue;
  }

  const nlVal = pm(data, "Non-Listed Total", "Non-Listed Value");
  const loansVal = pm(data, "Loans Outstanding");
  const privateTotal = nlVal > 0 ? nlVal : loansVal;
  if (privateTotal > 0) {
    buckets["Non-Listed"] = (buckets["Non-Listed"] ?? 0) + privateTotal;
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

export function computeIRR(data: WorkbookData): IRRData {
  const nav = pm(data, "Total Portfolio Value", "NAV", "Portfolio Value");
  const valuationDate = dateKey(data.cutoffDate);
  const precomputedInvestorIrr = pmIrr(data, "Investor IRR", "IRR Investor");

  let investorIrr: number | null = null;

  // If the tracker's IRR schedule already includes terminal NAV, trust its
  // official workbook IRR. Otherwise compute XIRR by appending terminal NAV.
  if (data.irrInvestor.length >= 1) {
    const cfs = data.irrInvestor.map((r) => ({ date: r.date, amount: r.cashFlow }));
    if (hasTerminalValue(cfs, data.cutoffDate, nav) && precomputedInvestorIrr !== null) {
      investorIrr = precomputedInvestorIrr;
    } else {
      cfs.push({ date: data.cutoffDate, amount: nav });
      investorIrr = xirrSafe(cfs);
    }
  }

  // Fall back to pre-computed Excel value if XIRR failed or no cash flows available.
  if (investorIrr === null) {
    investorIrr = precomputedInvestorIrr;
  }

  let fundIrr = pmIrr(data, "Fund IRR", "Company IRR");
  if (fundIrr === null && data.irrPortfolio.length >= 1) {
    const cfs = data.irrPortfolio.map((r) => ({ date: r.date, amount: r.cashFlow }));
    if (!hasTerminalValue(cfs, data.cutoffDate, nav)) {
      cfs.push({ date: data.cutoffDate, amount: nav });
    }
    fundIrr = xirrSafe(cfs);
  }
  if (fundIrr === null) fundIrr = investorIrr;

  return { fundIrr, investorIrr, valuationDate };
}

function sanitizeMonthlyReturns(returns: number[]): number[] {
  // Filter out extreme values caused by bond price misclassification in historical NAV.
  // Matches Python reference: all months included, only statistical outliers removed.
  return returns.filter((r) => r > -0.8 && r < 2.0);
}

function sanitizedMaxDrawdown(returns: number[]): number {
  const sanitized = sanitizeMonthlyReturns(returns);
  let value = 1.0;
  let peak = 1.0;
  let maxDd = 0;
  for (const r of sanitized) {
    value *= (1 + r);
    if (value > peak) peak = value;
    const dd = peak > 0 ? (value - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

export function computeRisk(data: WorkbookData, settings: Settings): RiskMetrics {
  const n = data.monthlyReturns.length;
  const pmSharpe   = pm(data, "Sharpe Ratio Precomputed");
  const pmVol      = pm(data, "Volatility Annualized");
  const pmDrawdown = pm(data, "Max Drawdown Precomputed");
  const pmAnnRet   = pm(data, "Annualized Return (TWR)", "Return Total");
  const rfRate     = pm(data, "Risk Free Rate") || settings.riskFreeRate;

  // Use Excel's precomputed values only if they look sane (vol < 500% and drawdown < 100%)
  if ((pmVol !== 0 || pmSharpe !== 0) && Math.abs(pmVol) < 5.0 && Math.abs(pmDrawdown) <= 1.0) {
    return {
      sharpeRatio: pmSharpe,
      volatilityAnnualized: pmVol,
      maxDrawdown: pmDrawdown,
      annualizedReturn: pmAnnRet > 1 ? pmAnnRet / 100 : pmAnnRet,
      riskFreeRate: rfRate,
      dataWindowMonths: n,
      betaVsMsciWorld: null,
    };
  }

  const returns = sanitizeMonthlyReturns(data.monthlyReturns.map((r) => r.monthlyReturn));

  if (returns.length < 2) {
    const ar = pmAnnRet > 1 ? pmAnnRet / 100 : pmAnnRet;
    return {
      sharpeRatio: 0,
      volatilityAnnualized: 0,
      maxDrawdown: sanitizedMaxDrawdown(data.monthlyReturns.map((r) => r.monthlyReturn)),
      annualizedReturn: ar,
      riskFreeRate: rfRate,
      dataWindowMonths: n,
      betaVsMsciWorld: null,
    };
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const volatilityAnnualized = Math.sqrt(variance * 12);

  // Annualized return: from stored metric if sane, else NAV-based TWR
  let ar: number;
  if (pmAnnRet !== 0 && Math.abs(pmAnnRet) < 5.0) {
    ar = pmAnnRet > 1 ? pmAnnRet / 100 : pmAnnRet;
  } else {
    const first = data.monthlyReturns[0]?.nav ?? 0;
    const last  = data.monthlyReturns[n - 1]?.nav ?? 0;
    const total = first > 0 ? (last - first) / first : 0;
    const years = n / 12;
    ar = years > 0 ? Math.pow(1 + total, 1 / years) - 1 : 0;
  }

  // Match Python reference: `sharpe = ... if vol_ann > 1e-10 else 0.0`
  // Guards against floating-point near-zero variance for constant return series.
  const sharpeRatio = volatilityAnnualized > 1e-10 ? (ar - rfRate) / volatilityAnnualized : 0;
  const maxDrawdown = sanitizedMaxDrawdown(data.monthlyReturns.map((r) => r.monthlyReturn));

  return {
    sharpeRatio,
    volatilityAnnualized,
    maxDrawdown,
    annualizedReturn: ar,
    riskFreeRate: rfRate,
    dataWindowMonths: n,
    betaVsMsciWorld: null,
  };
}

/**
 * Recomputes risk metrics from a stored timeseries slice (used for per-investor view
 * where the window starts at the investor's subscription date).
 */
export function recomputeRiskFromTimeseries(
  timeseries: NavPoint[],
  riskFreeRate: number,
  investorIrr?: number
): RiskMetrics {
  const n = timeseries.length;

  if (n < 2) {
    return {
      sharpeRatio: 0,
      volatilityAnnualized: 0,
      maxDrawdown: 0,
      annualizedReturn: investorIrr ?? 0,
      riskFreeRate,
      dataWindowMonths: n,
      betaVsMsciWorld: null,
    };
  }

  const returns = sanitizeMonthlyReturns(timeseries.map((p) => p.monthlyReturn));

  let volatilityAnnualized = 0;
  if (returns.length >= 2) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    volatilityAnnualized = Math.sqrt(variance * 12);
  }

  // Prefer investor IRR (entry-date-aware) as annualized return
  let annualizedReturn: number;
  if (investorIrr !== undefined) {
    annualizedReturn = investorIrr;
  } else {
    const first = timeseries[0].nav;
    const last  = timeseries[n - 1].nav;
    const total = first > 0 ? (last - first) / first : 0;
    const years = n / 12;
    annualizedReturn = years > 0 ? Math.pow(1 + total, 1 / years) - 1 : 0;
  }

  const sharpeRatio = volatilityAnnualized > 1e-10 ? (annualizedReturn - riskFreeRate) / volatilityAnnualized : 0;
  const maxDrawdown = sanitizedMaxDrawdown(timeseries.map((p) => p.monthlyReturn));

  return {
    sharpeRatio,
    volatilityAnnualized,
    maxDrawdown,
    annualizedReturn,
    riskFreeRate,
    dataWindowMonths: n,
    betaVsMsciWorld: null,
  };
}

export function computeDistributions(data: WorkbookData): DistributionEvent[] {
  return data.tradeLog
    .filter((r) => INCOME_TYPES.has(r.type))
    .map((r) => ({
      date: dateKey(r.date),
      security: r.security,
      incomeType: r.type,
      amount: Math.abs(r.netAmount),
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

  const nlVal = pm(data, "Non-Listed Total", "Non-Listed Value");
  const loansVal = pm(data, "Loans Outstanding");
  buckets.alts += nlVal > 0 ? nlVal : loansVal;

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
  const listed    = pm(data, "Listed Market Value", "Listed Value");
  const nlVal     = pm(data, "Non-Listed Total", "Non-Listed Value");
  const loansVal  = pm(data, "Loans Outstanding");
  const nonListed = nlVal > 0 ? nlVal : loansVal;
  const cash      = pm(data, "Total Cash", "Cash Balance (est.)", "Cash", "Cash Total", "Liquidity");
  return { listed, nonListed, cash, total: listed + nonListed + cash };
}

export function checkWarnings(data: WorkbookData, tolerance = 0.01): string[] {
  // Matches Python reference check_nav_reconciliation: compare holdings sum vs
  // the pre-computed "Total Market Value (Holdings)" metric in portfolio metrics.
  const warnings: string[] = [];
  const pmMv = pm(data, "Total Market Value (Holdings)", "Listed Market Value");
  if (pmMv === 0) return warnings;

  const holdingsMv = data.holdings.reduce((s, h) => s + h.marketValue, 0);
  const diff = Math.abs(holdingsMv - pmMv) / pmMv;
  if (diff > tolerance) {
    warnings.push(
      `NAV_RECONCILIATION_MISMATCH: holdings market value (${holdingsMv.toFixed(0)}) differs from portfolio metrics (${pmMv.toFixed(0)}) by ${(diff * 100).toFixed(1)}%, exceeding ${(tolerance * 100).toFixed(1)}% threshold.`
    );
  }
  return warnings;
}
