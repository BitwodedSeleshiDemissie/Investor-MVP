import { describe, expect, it, vi } from "vitest";
import type { PortfolioSnapshot } from "@/types/portfolio";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: {
    RISK_FREE_RATE: 0.035,
    MOIC_TARGET: 2.0,
    TARGET_EQUITY_PCT: 0.7,
    TARGET_BOND_PCT: 0.2,
    TARGET_ALT_PCT: 0.1,
    PORTFOLIO_ID: "TEST-001",
    INVESTOR_NAME: "Test Fund",
  },
}));
vi.mock("next/server", () => ({
  NextRequest: class extends Request {},
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(data), {
        status: (init as { status?: number } | undefined)?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import { buildDeterministicChecks } from "./directa-upload-checks";

function payload(): PortfolioSnapshot {
  return {
    kpis: {
      totalPortfolioValue: 1_000,
      capitalCommitted: 1_000,
      pctSinceEntry: 0,
      moic: 1,
      moicTarget: 2,
      currentYield: 0,
      distributionsTotal: 0,
      distributionsCount: 0,
      distributionsLastDate: null,
      totalIncome: 0,
    },
    timeseries: [],
    allocation: [],
    irr: { fundIrr: null, investorIrr: null, valuationDate: "2026-04-30" },
    risk: {
      sharpeRatio: 0,
      volatilityAnnualized: 0,
      maxDrawdown: 0,
      annualizedReturn: 0,
      riskFreeRate: 0.035,
      dataWindowMonths: 1,
      betaVsMsciWorld: null,
    },
    distributions: [],
    targets: {
      targetEquityPct: 0.7,
      targetBondPct: 0.2,
      targetAltPct: 0.1,
      currentEquityPct: 0,
      currentBondPct: 0,
      currentAltPct: 0,
      currentCashPct: 1,
    },
    holdings: [
      {
        security: "ENEL",
        assetClass: "Stock",
        currency: "EUR",
        shares: 100,
        avgCost: 4,
        costBasis: 400,
        currentPrice: 5,
        marketValue: 500,
        unrealizedPnl: 100,
        pnlPct: 0.25,
        weight: 1,
      },
    ],
    composition: { listed: 500, nonListed: 0, cash: 500, total: 1_000 },
    pnl: { unrealized: 100, realized: 0, netTotal: 0 },
    directaCash: 500,
    cutoffDate: "2026-04-30",
    investorName: "Test Fund",
    portfolioId: "TEST-001",
    warnings: [],
    investorPerformance: [
      {
        name: "Alice",
        type: "Individual",
        subscriptionDate: "2025-01-01",
        capitalEur: 1_000,
        units: 1,
        yearsElapsed: 1,
        navUnitAtSub: 1_000,
        currentValueEur: 1_000,
        moic: 1,
        irrAnnualized: 0,
      },
    ],
    overlaysFrozen: true,
    frozenAt: "2026-04-30T00:00:00Z",
  };
}

describe("Directa upload contract", () => {
  it("allows the CEO-style Estratto Conto statement without a positions file", () => {
    const checks = buildDeterministicChecks({
      uploaded: [
        {
          name: "Estratto Conto 2026-04-30.csv",
          content: "",
          statementRows: 12,
          positionRows: 0,
          hasLendingOrCollateralRows: false,
        },
      ],
      used: [
        {
          name: "Estratto Conto 2026-04-30.csv",
          content: "",
          statementRows: 12,
          positionRows: 0,
          hasLendingOrCollateralRows: false,
        },
      ],
      payload: payload(),
      previous: null,
      externalCash: 0,
    });

    expect(checks.some((check) => check.severity === "blocker")).toBe(false);
    expect(checks.map((check) => check.title)).toContain("CEO tracker valuation mode");
  });
});
