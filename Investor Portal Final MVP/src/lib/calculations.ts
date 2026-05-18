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

// Newton-Raphson XIRR — used as fallback when pre-computed value unavailable
function xirr(cashflows: { date: Date; amount: number }[]): number | null {
  if (cashflows.length < 2) return null;
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

  let rate = 0.1;
  for (let iter = 0; iter < 200; iter++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-12) break;
    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < 1e-8) return newRate;
    rate = newRate;
    if (rate < -0.9999) rate = -0.9999;
  }
  return null;
}

// Read a numeric value from portfolioMetrics by any of the given keys
function pm(data: WorkbookData, ...keys: string[]): number {
  for (const k of keys) {
    const v = data.portfolioMetrics[k];
    if (v !== undefined && v !== null && v !== "") return Number(v);
  }
  return 0;
}

function classifyAsset(assetClass: string): "equity" | "bonds" | "alts" | "cash" | "other" {
  const ac = assetClass.toLowerCase();
  if (ac.includes("stock") || ac.includes("equity")) return "equity";
  if (ac.includes("etf") || ac.includes("etc")) return "equity"; // equity ETFs grouped as equity
  if (ac.includes("bond") || ac.includes("fixed") || ac.includes("coupon")) return "bonds";
  if (ac.includes("crypto") || ac.includes("alternative") || ac.includes("etp")) return "alts";
  if (ac.includes("cash") || ac.includes("liquidity")) return "cash";
  return "other";
}

export function computeKPIs(data: WorkbookData, settings: Settings): KPIs {
  const nav = pm(data, "Total Portfolio Value", "NAV", "Portfolio Value");
  const committed = pm(data, "Capital Committed", "Total Invested Capital", "Committed Capital");

  // Total income: Div/Int Lordi Cum from tracker (already in portfolioMetrics)
  const pmIncome = pm(data, "Total Income (Div+Cpn+Dist)", "Total Income", "Total Distributions");
  const incomeRows = data.tradeLog.filter((r) => INCOME_TYPES.has(r.type));
  const tradeLogIncome = incomeRows.reduce((s, r) => s + r.netAmount, 0);
  const totalIncome = pmIncome > 0 ? pmIncome : Math.abs(tradeLogIncome);

  const pctSinceEntry = committed > 0 ? (nav - committed) / committed : 0;

  // MOIC = NAV / Capital (income is already inside NAV as cash)
  const moic = committed > 0 ? nav / committed : 0;

  const currentYield = nav > 0 ? totalIncome / nav : 0;

  const distributions = incomeRows.sort((a, b) => b.date.getTime() - a.date.getTime());
  const lastDate = distributions.length > 0 ? distributions[0].date.toISOString().split("T")[0] : null;

  return {
    totalPortfolioValue: nav,
    capitalCommitted: committed,
    pctSinceEntry,
    moic,
    moicTarget: settings.moicTarget,
    currentYield,
    distributionsTotal: totalIncome,
    distributionsCount: incomeRows.length,
    distributionsLastDate: lastDate,
    totalIncome,
  };
}

export function computeTimeseries(data: WorkbookData): NavPoint[] {
  if (data.monthlyReturns.length === 0) return [];
  const base = data.monthlyReturns[0].nav;
  let cumReturn = 0;
  return data.monthlyReturns.map((r) => {
    const normalized = base > 0 ? (r.nav / base) * 100 : 100;
    cumReturn = base > 0 ? (r.nav - base) / base : 0;
    return {
      monthEnd: r.monthEnd.toISOString().split("T")[0],
      nav: r.nav,
      normalized,
      monthlyReturn: r.monthlyReturn,
      cumulativeReturn: cumReturn,
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

  // Non-listed participations and loans as Private / Non-Listed bucket
  const nlVal = pm(data, "Non-Listed Total", "Non-Listed Value");
  const loansVal = pm(data, "Loans Outstanding");
  const privateTotal = nlVal + loansVal;
  if (privateTotal > 0) {
    buckets["Private / Non-Listed"] = (buckets["Private / Non-Listed"] ?? 0) + privateTotal;
  }

  // Cash
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
  const valuationDate = data.cutoffDate.toISOString().split("T")[0];

  // Prefer pre-computed IRR from 11_Performance (exact same as Excel)
  let investorIrr: number | null = null;
  const pmIrr = pm(data, "Investor IRR", "IRR Investor");
  if (pmIrr !== 0) {
    investorIrr = pmIrr > 1 ? pmIrr / 100 : pmIrr;
  }

  // Attempt XIRR from subscription cashflows (adds current NAV as terminal)
  if (investorIrr === null && data.irrInvestor.length > 1) {
    const cfs = [
      ...data.irrInvestor.map((r) => ({ date: r.date, amount: r.cashFlow })),
      { date: data.cutoffDate, amount: nav },
    ];
    investorIrr = xirr(cfs);
  }

  const fundIrr = investorIrr; // tracker uses investor perspective only

  return { fundIrr, investorIrr, valuationDate };
}

export function computeRisk(data: WorkbookData, settings: Settings): RiskMetrics {
  const returns = data.monthlyReturns.map((r) => r.monthlyReturn);
  const n = returns.length;

  // Use pre-computed risk values from 11_Performance when available
  const pmSharpe   = pm(data, "Sharpe Ratio Precomputed");
  const pmVol      = pm(data, "Volatility Annualized");
  const pmDrawdown = pm(data, "Max Drawdown Precomputed");
  const pmAnnRet   = pm(data, "Annualized Return (TWR)", "Return Total");
  const rfRate     = pm(data, "Risk Free Rate") || settings.riskFreeRate;

  if (pmVol !== 0 || pmSharpe !== 0 || pmDrawdown !== 0) {
    return {
      sharpeRatio: pmSharpe,
      volatilityAnnualized: pmVol,
      maxDrawdown: pmDrawdown,
      annualizedReturn: pmAnnRet,
      riskFreeRate: rfRate,
      dataWindowMonths: n,
    };
  }

  // Fallback: compute from monthly returns series
  if (n < 3) {
    return {
      sharpeRatio: 0,
      volatilityAnnualized: 0,
      maxDrawdown: 0,
      annualizedReturn: pmAnnRet > 1 ? pmAnnRet / 100 : pmAnnRet,
      riskFreeRate: rfRate,
      dataWindowMonths: n,
    };
  }

  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (n - 1);
  const volatilityAnnualized = Math.sqrt(variance * 12);
  const ar = pmAnnRet > 1 ? pmAnnRet / 100 : pmAnnRet > 0 ? pmAnnRet : mean * 12;
  const sharpeRatio = volatilityAnnualized > 0 ? (ar - rfRate) / volatilityAnnualized : 0;

  let maxDrawdown = 0;
  let peak = data.monthlyReturns[0]?.nav ?? 0;
  for (const r of data.monthlyReturns) {
    if (r.nav > peak) peak = r.nav;
    const dd = peak > 0 ? (r.nav - peak) / peak : 0;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  return {
    sharpeRatio,
    volatilityAnnualized,
    maxDrawdown,
    annualizedReturn: ar,
    riskFreeRate: rfRate,
    dataWindowMonths: n,
  };
}

export function computeDistributions(data: WorkbookData): DistributionEvent[] {
  return data.tradeLog
    .filter((r) => INCOME_TYPES.has(r.type))
    .map((r) => ({
      date: r.date.toISOString().split("T")[0],
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

  // Add non-listed participations and loans to alts
  const nlVal = pm(data, "Non-Listed Total", "Non-Listed Value");
  const loansVal = pm(data, "Loans Outstanding");
  buckets.alts += nlVal + loansVal;

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
  const nonListed = nlVal + loansVal;
  const cash      = pm(data, "Total Cash", "Cash Balance (est.)", "Cash", "Cash Total", "Liquidity");
  return { listed, nonListed, cash, total: listed + nonListed + cash };
}

export function checkWarnings(data: WorkbookData, tolerance = 0.01): string[] {
  const warnings: string[] = [];
  const nav = pm(data, "Total Portfolio Value", "NAV");
  const listedMv = pm(data, "Listed Market Value");
  const nonListed = pm(data, "Non-Listed Total", "Non-Listed Value");
  const loans = pm(data, "Loans Outstanding");
  const cash = pm(data, "Total Cash", "Cash Balance (est.)", "Cash");
  const reconstructed = listedMv + nonListed + loans + cash;
  if (nav > 0 && reconstructed > 0) {
    const diff = Math.abs(nav - reconstructed) / nav;
    if (diff > tolerance) {
      warnings.push(
        `NAV reconciliation: tracker NAV ${nav.toFixed(0)} vs components sum ${reconstructed.toFixed(0)} (${(diff * 100).toFixed(1)}% gap)`
      );
    }
  }
  return warnings;
}
