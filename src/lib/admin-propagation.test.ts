/**
 * Admin portal → investor portal propagation tests.
 *
 * Verifies the full chain:
 *   admin_manual_values → getFixedPortfolioValues (admin pages)
 *                       → manual-defaults API (pre-fills upload UI)
 *                       → manualInputs categorization (upload route)
 *                       → source record payload (per-investor)
 *                       → getPortfolioSnapshot (every investor)
 *
 * All tests run against mock DB — zero production data touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PortfolioSnapshot } from "@/types/portfolio";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ role: "admin", email: "admin@test.com" }),
  cleanDisplayName: (v: string | undefined | null) => v ?? null,
}));

const mockPrismaClient = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  $executeRaw: vi.fn().mockResolvedValue(0),
  $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrismaClient)),
  portfolio_snapshots: {
    create: vi.fn().mockResolvedValue({ id: BigInt(42) }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },
  investor_profiles: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
  },
  admin_controls: {
    create: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  admin_manual_values: {
    create: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn().mockResolvedValue(null),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  asset_dictionary: {
    upsert: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

vi.mock("@/db/prisma", () => ({ dbEnabled: () => true, getPrisma: () => mockPrismaClient }));

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

// ─── Lazy imports (after mocks) ────────────────────────────────────────────────

import { getFixedPortfolioValues } from "../server/queries/admin";
import { getPortfolioSnapshot } from "../server/queries/portfolio";
import { GET as manualDefaultsGet } from "../app/api/admin/manual-defaults/route";
import { getSession } from "@/lib/auth";

// ─── Shared source record payload ─────────────────────────────────────────────────────
// Alice: 500 units, 2 000 000 current value
// Bob:   250 units, 1 000 000 current value
// Total: 750 units, 3 000 000 (NAV/unit = 4 000)
// non-listed: PRIVATE_PARTICIPATIONS 300k + PRIVATE_LOAN_PRINCIPAL 200k = 500k
// cash:       directaCash 250k + CASH_OUTSIDE_DIRECTA 50k = 300k

function makeSourceRecordPayload(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    kpis: {
      totalPortfolioValue: 3_000_000,
      capitalCommitted: 1_500_000,
      pctSinceEntry: 0,
      moic: 1.0,
      moicTarget: 2.0,
      currentYield: 0,
      distributionsTotal: 0,
      distributionsCount: 0,
      distributionsLastDate: null,
      totalIncome: 0,
    },
    timeseries: [],
    allocation: [],
    irr: { fundIrr: 0.05, investorIrr: 0.05, valuationDate: "2025-12-31" },
    risk: {
      sharpeRatio: 0.5,
      volatilityAnnualized: 0.08,
      maxDrawdown: -0.05,
      annualizedReturn: 0.05,
      riskFreeRate: 0.035,
      dataWindowMonths: 12,
      betaVsMsciWorld: null,
    },
    distributions: [],
    targets: {
      targetEquityPct: 0.7,
      targetBondPct: 0.2,
      targetAltPct: 0.1,
      currentEquityPct: 0.6,
      currentBondPct: 0.2,
      currentAltPct: 0.1,
      currentCashPct: 0.1,
    },
    holdings: [],
    composition: { listed: 2_200_000, nonListed: 500_000, cash: 300_000, total: 3_000_000 },
    pnl: { unrealized: 0, realized: 0, netTotal: 0 },
    directaCash: 250_000,
    cutoffDate: "2025-12-31",
    investorName: "Test Fund",
    portfolioId: "TEST-001",
    warnings: [],
    investorPerformance: [
      {
        name: "Alice",
        type: "Individual",
        subscriptionDate: "2024-01-01",
        capitalEur: 1_000_000,
        units: 500,
        yearsElapsed: 2.0,
        navUnitAtSub: 2_000,
        currentValueEur: 2_000_000,
        moic: 2.0,
        irrAnnualized: 0.414,
      },
      {
        name: "Bob",
        type: "Individual",
        subscriptionDate: "2025-01-01",
        capitalEur: 500_000,
        units: 250,
        yearsElapsed: 1.0,
        navUnitAtSub: 2_000,
        currentValueEur: 1_000_000,
        moic: 2.0,
        irrAnnualized: 1.0,
      },
    ],
    sourceRecordReady: true,
    sourceRecordedAt: "2026-01-01T00:00:00Z",
    overlaySources: {
      capitalCommitted: 1_500_000,
      nonListedValue: 500_000,
      externalCash: 50_000,
      overlayItemCount: 3,
      investorProfileCount: 2,
      manualItems: [
        { item_key: "PRIVATE_PARTICIPATIONS", item_type: "Non-Listed", value: 300_000 },
        { item_key: "PRIVATE_LOAN_PRINCIPAL",  item_type: "Non-Listed", value: 200_000 },
        { item_key: "CASH_OUTSIDE_DIRECTA",   item_type: "Cash",       value: 50_000  },
      ],
    },
    ...overrides,
  };
}

// ─── 1. Admin admin_manual_values → getFixedPortfolioValues ───────────────────

describe("getFixedPortfolioValues — reads admin-entered values", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaClient.admin_controls.findFirst.mockReset().mockResolvedValue(null);
  });

  it("calculates cash outside brokerage from capital, brokerage value, and non-listed values", async () => {
    // Promise.all fires three $queryRaw calls concurrently; resolve each in order.
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([                                      // latest per key
        { item_key: "PRIVATE_PARTICIPATIONS", value: "400000" },
        { item_key: "PRIVATE_LOAN_PRINCIPAL",  value: "150000" },
        { item_key: "CASH_OUTSIDE_DIRECTA",   value: "75000"  },
      ])
      .mockResolvedValueOnce([])                                    // history rows
      .mockResolvedValueOnce([{
        direct_cash: "250000",
        payload: makeSourceRecordPayload({ composition: { listed: 100_000, nonListed: 550_000, cash: 350_000, total: 1_000_000 } }),
      }])
      .mockResolvedValueOnce([{ capital_committed: "1000000" }]);   // active investor capital

    const result = await getFixedPortfolioValues();

    expect(result.privateParticipations).toBe(400_000);
    expect(result.privateLoanPrincipal).toBe(150_000);
    expect(result.cashOutsideDirecta).toBe(100_000);
    expect(result.cashOutsideDirectaSource).toBe("calculated");
    expect(result.statementCash).toBe(250_000);
  });

  it("falls back to source record cash when no live cash row exists", async () => {
    const source = makeSourceRecordPayload();
    source.kpis.capitalCommitted = 0;
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([
        { item_key: "PRIVATE_PARTICIPATIONS", value: "400000" },
        { item_key: "PRIVATE_LOAN_PRINCIPAL",  value: "150000" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ direct_cash: "250000", payload: source }]);

    const result = await getFixedPortfolioValues();

    expect(result.cashOutsideDirecta).toBe(50_000);
    expect(result.cashOutsideDirectaSource).toBe("source_record");
    expect(result.statementCash).toBe(250_000);
  });

  it("returns zeros when no values have been entered yet", async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getFixedPortfolioValues();

    expect(result.privateParticipations).toBe(0);
    expect(result.privateLoanPrincipal).toBe(0);
    expect(result.cashOutsideDirecta).toBe(0);
    expect(result.statementCash).toBe(0);
    expect(result.history).toHaveLength(0);
  });

  it("builds approved balance history by carrying prior balances forward", async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { as_of_date: "2026-05-18", item_key: "PRIVATE_PARTICIPATION_ARITE_TECH_SOLUTIONS", value: "100000" },
        { as_of_date: "2026-05-18", item_key: "PRIVATE_PARTICIPATION_BOLLETTE_REPUBLIC", value: "30000" },
        { as_of_date: "2026-05-18", item_key: "PRIVATE_PARTICIPATION_BS2_SRL", value: "25000" },
        { as_of_date: "2026-05-18", item_key: "PRIVATE_LOAN_ATS", value: "135000" },
        { as_of_date: "2026-05-19", item_key: "PRIVATE_PARTICIPATION_ARITE_TECH_TEST_SOLTUONS", value: "117000" },
        { as_of_date: "2026-05-19", item_key: "PRIVATE_LOAN_BIT_PAYMENT_STYLE", value: "120" },
      ])
      .mockResolvedValueOnce([]);

    const result = await getFixedPortfolioValues();

    expect(result.history).toHaveLength(2);
    expect(result.history[0].asOfDate).toBe("2026-05-19"); // newest first
    expect(result.history[0].privateParticipations).toBe(272_000);
    expect(result.history[0].privateLoanPrincipal).toBe(135_120);
    expect(result.history[0].itemKeys).toEqual([
      "PRIVATE_PARTICIPATION_ARITE_TECH_TEST_SOLTUONS",
      "PRIVATE_LOAN_BIT_PAYMENT_STYLE",
    ]);
    expect(result.history[1].asOfDate).toBe("2026-05-18");
    expect(result.history[1].privateParticipations).toBe(155_000);
    expect(result.history[1].privateLoanPrincipal).toBe(135_000);
  });
});

// ─── 2. manualInputs categorization: non_listed → nonListedValue, cash → externalCash ───

describe("manualInputs categorization — non-listed vs cash split", () => {
  // This is the exact logic from the upload-snapshot route.
  function categorize(items: Array<{ item_type: string; value: number }>) {
    const nonListedValue = items
      .filter((i) => i.item_type.toLowerCase() !== "cash")
      .reduce((s, i) => s + Number(i.value), 0);
    const externalCash = items
      .filter((i) => i.item_type.toLowerCase() === "cash")
      .reduce((s, i) => s + Number(i.value), 0);
    return { nonListedValue, externalCash };
  }

  it("PRIVATE_PARTICIPATIONS and PRIVATE_LOAN_PRINCIPAL go to nonListedValue", () => {
    const { nonListedValue, externalCash } = categorize([
      { item_type: "Non-Listed", value: 300_000 },
      { item_type: "Non-Listed", value: 200_000 },
      { item_type: "Cash",       value: 50_000  },
    ]);
    expect(nonListedValue).toBe(500_000);
    expect(externalCash).toBe(50_000);
  });

  it("CASH_OUTSIDE_DIRECTA goes exclusively to externalCash", () => {
    const { nonListedValue, externalCash } = categorize([
      { item_type: "Cash", value: 75_000 },
    ]);
    expect(nonListedValue).toBe(0);
    expect(externalCash).toBe(75_000);
  });

  it("case-insensitive: CASH and cash and non-listed all route correctly", () => {
    const { nonListedValue, externalCash } = categorize([
      { item_type: "CASH",       value: 30_000 },
      { item_type: "cash",       value: 20_000 },
      { item_type: "non-listed", value: 100_000 },
      { item_type: "Non-Listed", value: 200_000 },
    ]);
    expect(externalCash).toBe(50_000);
    expect(nonListedValue).toBe(300_000);
  });

  it("empty items produce zero values", () => {
    const { nonListedValue, externalCash } = categorize([]);
    expect(nonListedValue).toBe(0);
    expect(externalCash).toBe(0);
  });
});

// ─── 3. Per-investor personalization from source record payload ──────────────────────

describe("getPortfolioSnapshot — per-investor slice from source record payload", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaClient.investor_profiles.findMany.mockReset().mockResolvedValue([]);
    mockPrismaClient.admin_controls.findFirst.mockReset().mockResolvedValue(null);
  });

  it("Alice gets her 2 000 000 slice (2/3 of fund)", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    const result = await getPortfolioSnapshot("Alice");

    expect(result.investorName).toBe("Alice");
    expect(result.kpis.totalPortfolioValue).toBeCloseTo(2_000_000);
    expect(result.kpis.capitalCommitted).toBe(1_000_000);
    expect(result.kpis.moic).toBeCloseTo(2.0, 3);
    expect(result.investorPerformance).toHaveLength(1);
    expect(result.investorPerformance[0].name).toBe("Alice");
  });

  it("Bob gets his 1 000 000 slice (1/3 of fund)", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    const result = await getPortfolioSnapshot("Bob");

    expect(result.investorName).toBe("Bob");
    expect(result.kpis.totalPortfolioValue).toBeCloseTo(1_000_000);
    expect(result.kpis.capitalCommitted).toBe(500_000);
    expect(result.investorPerformance[0].name).toBe("Bob");
  });

  it("sum of all investor slices equals the fund total", async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }])
      .mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    const [alice, bob] = await Promise.all([
      getPortfolioSnapshot("Alice"),
      getPortfolioSnapshot("Bob"),
    ]);

    expect(alice.kpis.totalPortfolioValue + bob.kpis.totalPortfolioValue)
      .toBeCloseTo(3_000_000);
  });

  it("fund-level view (no name) returns the full 3 000 000", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    const result = await getPortfolioSnapshot();

    expect(result.kpis.totalPortfolioValue).toBe(3_000_000);
    // Both investors present in fund view
    expect(result.investorPerformance).toHaveLength(2);
  });

  it("composition values are shared by all investors (non-listed and cash unchanged per-investor)", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    const result = await getPortfolioSnapshot("Alice");

    // Composition fields are fund-level and not scaled to the investor slice.
    // The investor sees the overall fund breakdown, not a scaled sub-portfolio.
    expect(result.composition.nonListed).toBe(500_000);
    expect(result.composition.cash).toBe(300_000);
    expect(result.composition.listed).toBe(2_200_000);
  });
});

// ─── 4. Dashboard read overlays live approved admin/profile changes ────────────

describe("source record — live dashboard overlay after publish", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaClient.investor_profiles.findMany.mockReset().mockResolvedValue([]);
    mockPrismaClient.admin_controls.findFirst.mockReset().mockResolvedValue(null);
  });

  it("admin_manual_values is queried so admin and investor cash stay aligned", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    await getPortfolioSnapshot("Alice");

    const sqls = mockPrismaClient.$queryRaw.mock.calls.map((args) => String(args[0]));
    expect(sqls.some((sql) => sql.includes("admin_manual_values"))).toBe(true);
  });

  it("investor_profiles is queried so new subscriptions affect dashboard cash", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    await getPortfolioSnapshot("Bob");

    expect(mockPrismaClient.investor_profiles.findMany).toHaveBeenCalled();
  });

  it("preserves matching source-record investor values", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);
    mockPrismaClient.investor_profiles.findMany.mockResolvedValueOnce([
      {
        name: "Alice",
        investor_type: "Individual",
        capital_eur: 1_000_000,
        units: 500,
        subscription_date: new Date("2024-01-01"),
        nav_unit_at_sub: 2_000,
      },
      {
        name: "Bob",
        investor_type: "Individual",
        capital_eur: 500_000,
        units: 250,
        subscription_date: new Date("2025-01-01"),
        nav_unit_at_sub: 2_000,
      },
    ]);

    const result = await getPortfolioSnapshot();

    expect(result.kpis.capitalCommitted).toBe(1_500_000);
    expect(result.directaCash).toBe(250_000);
    expect(result.composition.cash).toBe(300_000);
    expect(result.composition.total).toBe(3_000_000);
    expect(result.investorPerformance).toHaveLength(2);
    expect(result.investorPerformance.find((row) => row.name === "Alice")?.currentValueEur).toBe(2_000_000);
  });

  it("post-cutoff subscriptions increase client-visible cash without rewriting source investors", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);
    mockPrismaClient.investor_profiles.findMany.mockResolvedValueOnce([
      {
        name: "Alice",
        investor_type: "Individual",
        capital_eur: 1_000_000,
        units: 500,
        subscription_date: new Date("2024-01-01"),
        nav_unit_at_sub: 2_000,
      },
      {
        name: "Bob",
        investor_type: "Individual",
        capital_eur: 500_000,
        units: 250,
        subscription_date: new Date("2025-01-01"),
        nav_unit_at_sub: 2_000,
      },
      {
        name: "Charlie",
        investor_type: "Individual",
        capital_eur: 500_000,
        units: 125,
        subscription_date: new Date("2026-01-15"),
        nav_unit_at_sub: 4_000,
      },
    ]);

    const result = await getPortfolioSnapshot();

    expect(result.kpis.capitalCommitted).toBe(2_000_000);
    expect(result.composition.cash).toBe(800_000);
    expect(result.composition.total).toBe(3_500_000);
    expect(result.investorPerformance.find((row) => row.name === "Alice")?.currentValueEur).toBe(2_000_000);
    expect(result.investorPerformance.find((row) => row.name === "Charlie")?.currentValueEur).toBe(500_000);
  });

  it("dated profile changes at or before the valuation date supersede source-record investor valuation", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);
    mockPrismaClient.investor_profiles.findMany.mockResolvedValueOnce([
      {
        name: "Alice",
        investor_type: "Individual",
        capital_eur: 1_500_000,
        units: 1_000,
        subscription_date: new Date("2024-01-01"),
        nav_unit_at_sub: 1_500,
      },
      {
        name: "Bob",
        investor_type: "Individual",
        capital_eur: 1_500_000,
        units: 250,
        subscription_date: new Date("2025-01-01"),
        nav_unit_at_sub: 2_000,
      },
    ]);

    const result = await getPortfolioSnapshot();

    expect(result.kpis.capitalCommitted).toBe(3_000_000);
    expect(result.composition.cash).toBe(300_000);
    expect(result.investorPerformance).toHaveLength(2);
    expect(result.investorPerformance.find((row) => row.name === "Alice")?.currentValueEur).toBe(2_400_000);
    expect(result.investorPerformance.find((row) => row.name === "Bob")?.currentValueEur).toBe(600_000);
  });

  it("non-listed value is the source-record 500k even if admin_manual_values would have 0", async () => {
    // Simulate: admin deleted the entry after publish — no rows would come back
    // from admin_manual_values. source record must still show 500k.
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-12-31", payload: makeSourceRecordPayload() }]);

    const result = await getPortfolioSnapshot();

    expect(result.composition.nonListed).toBe(500_000);
  });

  it("unprepared source record does query investor_profiles", async () => {
    const unprepared = makeSourceRecordPayload({
      sourceRecordReady: false,
      sourceRecordedAt: undefined,
      investorPerformance: [],
    });
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-03-31", payload: unprepared }]);
    mockPrismaClient.investor_profiles.findMany.mockResolvedValueOnce([]);

    await getPortfolioSnapshot();

    expect(mockPrismaClient.investor_profiles.findMany).toHaveBeenCalled();
  });
});

// ─── 5. manual-defaults API — bridge between admin_manual_values and upload UI ─

describe("manual-defaults API — pre-fills upload UI with latest admin values", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    vi.mocked(getSession).mockResolvedValue(
      { role: "admin", email: "admin@test.com" } as Awaited<ReturnType<typeof getSession>>
    );
  });

  it("returns non-listed fixed keys with their latest values populated", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([
      {
        item_key: "PRIVATE_PARTICIPATIONS",
        display_name: "Private Participations",
        item_type: "Non-Listed",
        subcategory: "Private Participation",
        latest_value: "400000",
        latest_date: "2025-12-31",
      },
      {
        item_key: "PRIVATE_LOAN_PRINCIPAL",
        display_name: "Private Loan Principal",
        item_type: "Non-Listed",
        subcategory: "Private Loan",
        latest_value: "150000",
        latest_date: "2025-12-31",
      },
    ]);

    const response = await manualDefaultsGet();
    const body = (await response.json()) as {
      items: Array<{ item_key: string; item_type: string; latest_value: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);

    const part = body.items.find((i) => i.item_key === "PRIVATE_PARTICIPATIONS")!;
    expect(part.latest_value).toBe("400000");
    expect(part.item_type).toBe("Non-Listed");

    const loan = body.items.find((i) => i.item_key === "PRIVATE_LOAN_PRINCIPAL")!;
    expect(loan.latest_value).toBe("150000");

    expect(body.items.find((i) => i.item_type === "Cash")).toBeUndefined();
  });

  it("returns null latest_value when admin has not entered any values yet", async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([
      {
        item_key: "PRIVATE_PARTICIPATIONS",
        display_name: "Private Participations",
        item_type: "Non-Listed",
        subcategory: "Private Participation",
        latest_value: null,
        latest_date: null,
      },
    ]);

    const response = await manualDefaultsGet();
    const body = (await response.json()) as { items: Array<{ item_key: string; latest_value: string | null }> };

    expect(body.items[0].latest_value).toBeNull();
  });

  it("returns 403 for non-admin sessions", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(
      { role: "investor", email: "alice@example.com" } as Awaited<ReturnType<typeof getSession>>
    );

    const response = await manualDefaultsGet();
    expect(response.status).toBe(403);
  });
});
