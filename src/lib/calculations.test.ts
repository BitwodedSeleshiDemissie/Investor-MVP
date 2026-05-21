import { describe, expect, it } from "vitest";
import {
  checkWarnings,
  computeKPIs,
  computeIRR,
  computeRisk,
  computeTargets,
  computeTimeseries,
  xirrSafe,
} from "./calculations";
import type { WorkbookData, MonthlyReturnRow, TradeRow, HoldingRow, CashFlowRow } from "./excel-loader";

const settings = {
  riskFreeRate: 0.035,
  moicTarget: 2.0,
  targetEquityPct: 0.7,
  targetBondPct: 0.2,
  targetAltPct: 0.1,
};

function d(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function makeWorkbook(overrides: Partial<{
  portfolioValue: number;
  capitalCommitted: number;
  cash: number;
  holdingsMv: number;
  totalIncome: number;
  monthlyReturns: MonthlyReturnRow[];
  tradeLog: TradeRow[];
  holdings: HoldingRow[];
  irrInvestor: CashFlowRow[];
  irrPortfolio: CashFlowRow[];
}> = {}): WorkbookData {
  const tradeLog = overrides.tradeLog ?? [
    incomeRow(d(2025, 8, 6), "ASML", "Dividend", 27.2),
    incomeRow(d(2025, 9, 19), "PIAGGIO", "Dividend", 200),
    incomeRow(d(2025, 10, 3), "SOME BOND", "Coupon", 500),
  ];

  const holdings = overrides.holdings ?? [
    holdingRow("MONCLER", "Stock", 154_200),
    holdingRow("BTP AUG26", "Bond", 100_300),
  ];

  return {
    tradeLog,
    holdings,
    portfolioMetrics: {
      "Total Invested Capital": overrides.capitalCommitted ?? 1_250_000,
      "Total Withdrawals": -30_000,
      "Net Capital Deployed": (overrides.capitalCommitted ?? 1_250_000) - 30_000,
      "Total Market Value (Holdings)": overrides.holdingsMv ?? 1_070_303.94,
      "Listed Market Value": overrides.holdingsMv ?? 1_070_303.94,
      "Cash Balance (est.)": overrides.cash ?? 97_547.74,
      "Statement Cash": overrides.cash ?? 97_547.74,
      "Total Portfolio Value": overrides.portfolioValue ?? 1_167_851.68,
      "Total Income (Div+Cpn+Dist)": overrides.totalIncome ?? 4_674.71,
      "Annualized Return (TWR)": 0.010104,
      "Monthly Std Dev": 0.027455,
      "Investor IRR": -0.061552,
      "Company IRR": -0.087395,
    },
    irrInvestor: overrides.irrInvestor ?? [
      { date: d(2025, 3, 26), cashFlow: -350_000 },
      { date: d(2025, 6, 17), cashFlow: -100_000 },
    ],
    irrPortfolio: overrides.irrPortfolio ?? [
      { date: d(2025, 5, 30), cashFlow: -30_555 },
      { date: d(2025, 8, 6), cashFlow: 27.2 },
    ],
    monthlyReturns: overrides.monthlyReturns ?? [
      monthlyRow(d(2025, 1, 31), 9_246.42, 0, 0),
      monthlyRow(d(2025, 2, 28), 9_509.36, 0.028437, 0.028437),
      monthlyRow(d(2025, 3, 31), 362_517.02, 0.008366, 0.037041),
    ],
    cutoffDate: d(2026, 3, 31),
    investorPerformance: [],
  };
}

function incomeRow(date: Date, security: string, type: string, netAmount: number): TradeRow {
  return { date, security, assetClass: "", currency: "EUR", type, shares: 0, price: 0, netAmount };
}

function holdingRow(security: string, assetClass: string, marketValue: number): HoldingRow {
  return {
    security,
    assetClass,
    currency: "EUR",
    shares: 1,
    avgCost: 0,
    costBasis: 0,
    currentPrice: marketValue,
    marketValue,
    unrealizedPnl: 0,
    pnlPct: 0,
    weight: 0,
  };
}

function monthlyRow(monthEnd: Date, nav: number, monthlyReturn: number, cumulativeReturn: number): MonthlyReturnRow {
  return { monthEnd, nav, monthlyReturn, cumulativeReturn };
}

function dataWithReturns(returns: number[]): WorkbookData {
  let nav = 100_000;
  const rows = returns.map((monthlyReturn, i) => {
    nav *= 1 + monthlyReturn;
    return monthlyRow(d(2024, i + 1, 28), nav, monthlyReturn, 0);
  });
  return makeWorkbook({ monthlyReturns: rows });
}

describe("xirrSafe", () => {
  it("computes a simple positive IRR", () => {
    const result = xirrSafe([
      { date: d(2024, 1, 1), amount: -1000 },
      { date: d(2025, 1, 1), amount: 1100 },
    ]);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.1, 3);
  });

  it("computes a simple negative IRR", () => {
    const result = xirrSafe([
      { date: d(2024, 1, 1), amount: -1000 },
      { date: d(2025, 1, 1), amount: 900 },
    ]);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it("returns null on degenerate input", () => {
    expect(xirrSafe([{ date: d(2024, 1, 1), amount: -1000 }])).toBeNull();
  });
});

describe("computeKPIs", () => {
  it("reads total portfolio value", () => {
    expect(computeKPIs(makeWorkbook({ portfolioValue: 1_167_851.68 }), settings).totalPortfolioValue)
      .toBeCloseTo(1_167_851.68);
  });

  it("reads capital committed", () => {
    expect(computeKPIs(makeWorkbook({ capitalCommitted: 1_250_000 }), settings).capitalCommitted)
      .toBe(1_250_000);
  });

  it("computes percent since entry", () => {
    expect(computeKPIs(makeWorkbook({ portfolioValue: 1_100_000, capitalCommitted: 1_000_000 }), settings).pctSinceEntry)
      .toBeCloseTo(0.1);
  });

  it("computes MOIC from NAV plus total income", () => {
    expect(computeKPIs(makeWorkbook({ portfolioValue: 1_000_000, capitalCommitted: 1_000_000, totalIncome: 50_000 }), settings).moic)
      .toBeCloseTo(1.05);
  });

  it("counts only positive distribution rows", () => {
    const tradeLog = [
      incomeRow(d(2025, 9, 10), "ISHARES HY", "Distribution", 604.33),
      incomeRow(d(2025, 9, 10), "ISHARES HY", "Distribution", -156.73),
    ];
    expect(computeKPIs(makeWorkbook({ tradeLog }), settings).distributionsCount).toBe(1);
  });

  it("nets withholding rows in distribution total", () => {
    const tradeLog = [
      incomeRow(d(2025, 9, 10), "ISHARES HY", "Distribution", 604.33),
      incomeRow(d(2025, 9, 10), "ISHARES HY", "Distribution", -156.73),
    ];
    // totalIncome: 0 forces the tradeLog-computed net path (pmIncome takes priority when > 0)
    expect(computeKPIs(makeWorkbook({ tradeLog, totalIncome: 0 }), settings).distributionsTotal).toBeCloseTo(447.6, 2);
  });
});

describe("computeTimeseries", () => {
  it("builds a TWR index from cumulative return", () => {
    const rows = [
      monthlyRow(d(2025, 1, 31), 100, 0, 0),
      monthlyRow(d(2025, 2, 28), 1_000, 0.1, 0.1),
    ];
    expect(computeTimeseries(makeWorkbook({ monthlyReturns: rows }))[1].normalized).toBeCloseTo(110);
  });

  it("normalizes the first point to 100", () => {
    expect(computeTimeseries(makeWorkbook())[0].normalized).toBeCloseTo(100);
  });

  it("keeps the input month count", () => {
    expect(computeTimeseries(makeWorkbook())).toHaveLength(3);
  });
});

describe("computeIRR", () => {
  it("matches investor terminal value to statement-account cash flows", () => {
    // portfolioValue = investment amount → single-period breakeven → XIRR ≈ 0%
    const data = makeWorkbook({
      portfolioValue: 1_200,
      holdingsMv: 1_100,
      cash: 100,
      irrInvestor: [{ date: d(2025, 3, 31), cashFlow: -1_200 }],
    });

    const irr = computeIRR(data);

    expect(irr.investorIrr).not.toBeNull();
    expect(irr.investorIrr!).toBeCloseTo(0, 2);
  });

  it("does not double-count tracker IRR schedules that already include terminal NAV", () => {
    const nav = 1_971_514.4958473404;
    const data = makeWorkbook({
      portfolioValue: nav,
      irrInvestor: [
        { date: d(2025, 3, 19), cashFlow: -500_000 },
        { date: d(2025, 9, 3), cashFlow: -500_000 },
        { date: d(2025, 9, 9), cashFlow: -500_000 },
        { date: d(2026, 3, 15), cashFlow: -500_000 },
        { date: d(2026, 5, 18), cashFlow: nav },
      ],
      irrPortfolio: [],
    });
    data.cutoffDate = d(2026, 5, 18);
    data.portfolioMetrics["Fund IRR"] = -0.02091006934642792;
    data.portfolioMetrics["Investor IRR"] = -0.02091006934642792;

    const irr = computeIRR(data);

    expect(irr.investorIrr).toBeCloseTo(-0.02091006934642792, 6);
    expect(irr.fundIrr).toBeCloseTo(-0.02091006934642792, 6);
  });
});

describe("computeRisk", () => {
  it("uses sample standard deviation for annualized volatility", () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02];
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    expect(computeRisk(dataWithReturns(returns), { ...settings, riskFreeRate: 0 }).volatilityAnnualized)
      .toBeCloseTo(Math.sqrt(variance) * Math.sqrt(12), 4);
  });

  it("returns zero Sharpe for constant returns", () => {
    expect(computeRisk(dataWithReturns(Array(12).fill(0.01)), { ...settings, riskFreeRate: 0 }).sharpeRatio)
      .toBe(0);
  });

  it("returns negative max drawdown after a loss", () => {
    expect(computeRisk(dataWithReturns([0.05, 0.03, -0.1, 0.02]), settings).maxDrawdown)
      .toBeLessThan(0);
  });

  it("returns no drawdown for monotone-up returns", () => {
    expect(computeRisk(dataWithReturns([0.01, 0.02, 0.03]), settings).maxDrawdown)
      .toBeCloseTo(0);
  });

  it("keeps beta unavailable", () => {
    expect(computeRisk(makeWorkbook(), settings).betaVsMsciWorld).toBeNull();
  });
});

describe("max drawdown formula", () => {
  it("matches the known 25 percent drawdown example", () => {
    const navs = [100, 120, 90, 95];
    let peak = navs[0];
    const drawdowns = navs.map((nav) => {
      peak = Math.max(peak, nav);
      return nav / peak - 1;
    });
    expect(Math.min(...drawdowns)).toBeCloseTo(-0.25, 4);
  });
});

describe("computeTargets", () => {
  it("matches the Python target buckets: stocks as equity, ETFs and crypto as alternatives", () => {
    const holdings = [
      holdingRow("STOCK", "Stock", 700),
      holdingRow("BOND", "Bond", 200),
      holdingRow("ETF", "ETF/ETC", 50),
      holdingRow("BTC ETP", "Crypto ETP", 50),
    ];

    const targets = computeTargets(
      makeWorkbook({ portfolioValue: 1_000, cash: 0, holdings }),
      settings
    );

    expect(targets.currentEquityPct).toBeCloseTo(0.7);
    expect(targets.currentBondPct).toBeCloseTo(0.2);
    expect(targets.currentAltPct).toBeCloseTo(0.1);
  });
});

describe("checkWarnings", () => {
  it("does not warn when holdings match the reported holdings metric", () => {
    const holdings = [holdingRow("MONCLER", "Stock", 154_200), holdingRow("BTP AUG26", "Bond", 100_300)];
    expect(checkWarnings(makeWorkbook({ holdings, holdingsMv: 254_500 }), 0.005)).toHaveLength(0);
  });

  it("warns when holdings exceed tolerance", () => {
    const warnings = checkWarnings(makeWorkbook({ holdingsMv: 900_000 }), 0.005);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("NAV_RECONCILIATION_MISMATCH");
  });
});
