/**
 * CEO tracker seed + architecture contract tests.
 *
 * 1. CEO workbook seed preserves all workbook numbers in frozen payload.
 * 2. CEO seed upserts investor profiles from 12_Perf_Investitori into investor_profiles table.
 * 3. CEO seed snapshot is published + frozen with overlaySources.source = "CEO tracker workbook".
 * 4. CEO seed returns 422 when 12_Perf_Investitori has no rows.
 * 5. investorPerformance in frozen payload exactly matches workbook sheet rows.
 * 6. Publish route rejects draft with "No investor profiles configured" blocker.
 * 7. Frozen CEO seed payload bypasses investor_profiles live reads.
 * 8. Official .xlsx CEO seed snapshots are eligible for dashboard reads.
 * 9. CEO seed creates monthly-upload defaults for controls and non-Directa items.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PortfolioSnapshot } from "@/types/portfolio";

// ─── Module mocks (hoisted before any import) ────────────────────────────────

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
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
  non_listed_transactions: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  },
  private_loan_transactions: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
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

const mockLoadWorkbookFromBuffer = vi.fn();
vi.mock("@/lib/excel-loader", () => ({
  loadWorkbookFromBuffer: (...args: unknown[]) => mockLoadWorkbookFromBuffer(...args),
  INCOME_TYPES: new Set(["DIVIDEND", "INTEREST", "ETF_INCOME", "COUPON", "Dividend", "Coupon", "Distribution", "Income"]),
  INVESTOR_FLOW_TYPES: new Set(["Deposit", "Withdrawal"]),
}));

// ─── Lazy imports (after mocks) ───────────────────────────────────────────────

import { POST as ceoUploadPost } from "../app/api/admin/upload/route";
import { POST as publishPost } from "../app/api/admin/publish-snapshot/route";
import { getPortfolioSnapshot } from "../server/queries/portfolio";
import { getSession } from "@/lib/auth";

function payloadFromCreateCall(call: unknown): PortfolioSnapshot {
  return (call as { data: { payload: PortfolioSnapshot } }).data.payload;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWorkbookData() {
  return {
    tradeLog: [],
    holdings: [],
    portfolioMetrics: {
      "Total Portfolio Value": 2_000_000,
      "NAV": 2_000_000,
      "Capital Committed": 1_800_000,
      "Total Income": 60_000,
      "Total Distributions": 60_000,
      "Listed Market Value": 1_700_000,
      "Non-Listed Total": 200_000,
      "Loans Outstanding": 0,
      "Total Cash": 100_000,
      "Cash": 100_000,
      "Fund IRR": 0.062,
      "Investor IRR": 0.062,
      "Annualized Return (TWR)": 0.06,
      "MOIC Precomputed": 1.14,
      "Volatility Annualized": 0.08,
      "Sharpe Ratio Precomputed": 0.5,
      "Max Drawdown Precomputed": -0.05,
      "Risk Free Rate": 0.035,
      "NAV Unit": 8_000,
      "Units Outstanding": 250,
      "Unrealized P&L": 0,
      "Realized P&L": 0,
      "Net Total P&L": 200_000,
    },
    irrInvestor: [],
    irrPortfolio: [],
    monthlyReturns: [],
    cutoffDate: new Date("2025-03-31"),
    manualItems: [] as {
      itemKey: string;
      displayName: string;
      itemType: "Non-Listed" | "Cash";
      subcategory: string;
      value: number;
      notes: string;
      sortOrder: number;
    }[],
    investorPerformance: [
      {
        name: "Alice",
        type: "Individual",
        subscriptionDate: new Date("2024-01-01"),
        capitalEur: 900_000,
        units: 125,
        yearsElapsed: 1.25,
        navUnitAtSub: 7_200,
        currentValueEur: 1_000_000,
        moic: 1.111,
        irrAnnualized: 0.085,
      },
      {
        name: "Bob",
        type: "LLC",
        subscriptionDate: new Date("2024-06-01"),
        capitalEur: 900_000,
        units: 125,
        yearsElapsed: 0.75,
        navUnitAtSub: 7_200,
        currentValueEur: 1_000_000,
        moic: 1.111,
        irrAnnualized: 0.148,
      },
    ],
  };
}

function makeFrozenPayload(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    kpis: {
      totalPortfolioValue: 2_000_000,
      capitalCommitted: 1_800_000,
      pctSinceEntry: 0.111,
      moic: 1.15,
      moicTarget: 2.0,
      currentYield: 0.03,
      distributionsTotal: 50_000,
      distributionsCount: 3,
      distributionsLastDate: "2025-03-01",
      totalIncome: 60_000,
    },
    timeseries: [],
    allocation: [],
    irr: { fundIrr: 0.062, investorIrr: 0.055, valuationDate: "2025-03-31" },
    risk: {
      sharpeRatio: 0.5,
      volatilityAnnualized: 0.08,
      maxDrawdown: -0.05,
      annualizedReturn: 0.06,
      riskFreeRate: 0.035,
      dataWindowMonths: 12,
      betaVsMsciWorld: null,
    },
    distributions: [],
    targets: {
      targetEquityPct: 0.7,
      targetBondPct: 0.2,
      targetAltPct: 0.1,
      currentEquityPct: 0.65,
      currentBondPct: 0.2,
      currentAltPct: 0.1,
      currentCashPct: 0.05,
    },
    holdings: [],
    composition: { listed: 1_700_000, nonListed: 200_000, cash: 100_000, total: 2_000_000 },
    pnl: { unrealized: 0, realized: 0, netTotal: 200_000 },
    directaCash: 100_000,
    cutoffDate: "2025-03-31",
    investorName: "Test Fund",
    portfolioId: "TEST-001",
    warnings: [],
    investorPerformance: [
      {
        name: "Alice",
        type: "Individual",
        subscriptionDate: "2024-01-01",
        capitalEur: 900_000,
        units: 125,
        yearsElapsed: 1.25,
        navUnitAtSub: 7_200,
        currentValueEur: 1_000_000,
        moic: 1.111,
        irrAnnualized: 0.085,
      },
    ],
    overlaysFrozen: true,
    frozenAt: "2025-04-01T10:00:00Z",
    overlaySources: {
      capitalCommitted: 1_800_000,
      nonListedValue: 200_000,
      externalCash: 0,
      overlayItemCount: 0,
      investorProfileCount: 2,
      manualItems: [],
      source: "CEO tracker workbook",
    },
    ...overrides,
  };
}

async function callCeoUpload(workbookData: ReturnType<typeof makeWorkbookData>) {
  mockLoadWorkbookFromBuffer.mockReturnValueOnce(workbookData);
  const form = new FormData();
  form.append(
    "file",
    new File([Buffer.alloc(100)], "tracker-2025-03.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
  const req = new Request("http://localhost/api/admin/upload", {
    method: "POST",
    body: form,
  });
  return ceoUploadPost(req as Parameters<typeof ceoUploadPost>[0]);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
  mockPrismaClient.$executeRaw.mockReset().mockResolvedValue(0);
  mockPrismaClient.$transaction.mockReset().mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrismaClient)
  );
  mockPrismaClient.portfolio_snapshots.create.mockReset().mockResolvedValue({ id: BigInt(42) });
  mockPrismaClient.portfolio_snapshots.findUnique.mockReset().mockResolvedValue(null);
  mockPrismaClient.portfolio_snapshots.update.mockReset().mockResolvedValue({});
  mockPrismaClient.investor_profiles.findMany.mockReset().mockResolvedValue([]);
  mockPrismaClient.investor_profiles.upsert.mockReset().mockResolvedValue({});
  mockPrismaClient.admin_controls.create.mockReset().mockResolvedValue({});
  mockPrismaClient.admin_controls.findFirst.mockReset().mockResolvedValue(null);
  mockPrismaClient.admin_manual_values.create.mockReset().mockResolvedValue({});
  mockPrismaClient.admin_manual_values.findFirst.mockReset().mockResolvedValue(null);
  mockPrismaClient.asset_dictionary.upsert.mockReset().mockResolvedValue({});
  mockPrismaClient.non_listed_transactions.findFirst.mockReset().mockResolvedValue(null);
  mockPrismaClient.non_listed_transactions.create.mockReset().mockResolvedValue({});
  mockPrismaClient.private_loan_transactions.findFirst.mockReset().mockResolvedValue(null);
  mockPrismaClient.private_loan_transactions.create.mockReset().mockResolvedValue({});
  vi.mocked(getSession).mockResolvedValue(
    { role: "admin", email: "admin@test.com" } as Awaited<ReturnType<typeof getSession>>
  );
});

// ─── Tests 1–5: CEO workbook seed ────────────────────────────────────────────

describe("CEO tracker workbook seed", () => {
  it("(1) preserves all workbook numbers in frozen payload", async () => {
    const wb = makeWorkbookData();
    const response = await callCeoUpload(wb);
    expect(response.status).toBe(200);

    const createCall = mockPrismaClient.portfolio_snapshots.create.mock.calls[0][0];
    const payload = payloadFromCreateCall(createCall);

    expect(payload.kpis.totalPortfolioValue).toBe(2_000_000);
    expect(payload.kpis.capitalCommitted).toBe(1_800_000);
    expect(payload.composition.listed).toBe(1_700_000);
    expect(payload.composition.nonListed).toBe(200_000);
    expect(payload.composition.cash).toBe(100_000);
    expect(payload.irr.fundIrr).toBe(0.062);
    expect(payload.directaCash).toBe(100_000);
  });

  it("(2) upserts investor profiles from 12_Perf_Investitori into investor_profiles", async () => {
    const wb = makeWorkbookData();
    const response = await callCeoUpload(wb);
    expect(response.status).toBe(200);

    expect(mockPrismaClient.investor_profiles.upsert).toHaveBeenCalledTimes(2);

    const upsertCalls = mockPrismaClient.investor_profiles.upsert.mock.calls;
    const names = upsertCalls.map((args) => (args[0] as { create: { name: string } }).create.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");

    const aliceCall = upsertCalls.find(
      (args) => (args[0] as { create: { name: string } }).create.name === "Alice"
    );
    expect(aliceCall).toBeDefined();
    const aliceCreate = (aliceCall![0] as { create: Record<string, unknown> }).create;
    expect(aliceCreate.capital_eur).toBe(900_000);
    expect(aliceCreate.units).toBe(125);
    expect(aliceCreate.nav_unit_at_sub).toBe(7_200);
  });

  it("(3) snapshot is published + frozen with overlaySources.source = 'CEO tracker workbook'", async () => {
    const wb = makeWorkbookData();
    const response = await callCeoUpload(wb);
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      ok: boolean;
      publicationStatus: string;
      overlaysFrozen: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.publicationStatus).toBe("published");
    expect(json.overlaysFrozen).toBe(true);

    const createCall = mockPrismaClient.portfolio_snapshots.create.mock.calls[0][0];
    expect(createCall.data.publication_status).toBe("published");

    const payload = payloadFromCreateCall(createCall);
    expect(payload.overlaysFrozen).toBe(true);
    expect(payload.overlaySources?.source).toBe("CEO tracker workbook");
  });

  it("(3b) freezes manual non-Directa item breakdown from the workbook", async () => {
    const wb = makeWorkbookData();
    wb.manualItems = [
      {
        itemKey: "TRACKER_PARTICIPATION_ALPHA",
        displayName: "Alpha",
        itemType: "Non-Listed",
        subcategory: "Participation",
        value: 150_000,
        notes: "from workbook",
        sortOrder: 10,
      },
      {
        itemKey: "TRACKER_LOAN_BETA",
        displayName: "Beta",
        itemType: "Non-Listed",
        subcategory: "Private Loan",
        value: 50_000,
        notes: "from workbook",
        sortOrder: 100,
      },
    ];
    const response = await callCeoUpload(wb);
    expect(response.status).toBe(200);

    const createCall = mockPrismaClient.portfolio_snapshots.create.mock.calls[0][0];
    const payload = payloadFromCreateCall(createCall);
    expect(payload.overlaySources?.manualItems).toEqual([
      {
        item_key: "TRACKER_PARTICIPATION_ALPHA",
        item_type: "Non-Listed",
        value: 150_000,
        value_date: "2025-03-31",
        display_name: "Alpha",
        subcategory: "Participation",
      },
      {
        item_key: "TRACKER_LOAN_BETA",
        item_type: "Non-Listed",
        value: 50_000,
        value_date: "2025-03-31",
        display_name: "Beta",
        subcategory: "Private Loan",
      },
    ]);
    expect(payload.overlaySources?.overlayItemCount).toBe(2);
  });

  it("(4) returns 422 when 12_Perf_Investitori has no investor rows", async () => {
    const wb = makeWorkbookData();
    wb.investorPerformance = [];
    const response = await callCeoUpload(wb);
    expect(response.status).toBe(422);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/12_Perf_Investitori/);
    // No DB write should happen
    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
  });

  it("(5) investorPerformance in frozen payload exactly matches workbook sheet rows", async () => {
    const wb = makeWorkbookData();
    const response = await callCeoUpload(wb);
    expect(response.status).toBe(200);

    const createCall = mockPrismaClient.portfolio_snapshots.create.mock.calls[0][0];
    const payload = payloadFromCreateCall(createCall);

    expect(payload.investorPerformance).toHaveLength(2);
    const alice = payload.investorPerformance.find((p) => p.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice!.units).toBe(125);
    expect(alice!.capitalEur).toBe(900_000);
    expect(alice!.navUnitAtSub).toBe(7_200);
    expect(alice!.moic).toBe(1.111);
    expect(alice!.irrAnnualized).toBe(0.085);
    expect(alice!.subscriptionDate).toBe("2024-01-01");

    const bob = payload.investorPerformance.find((p) => p.name === "Bob");
    expect(bob).toBeDefined();
    expect(bob!.type).toBe("LLC");
    expect(bob!.irrAnnualized).toBe(0.148);
  });
});

// ─── Test 6: No investor profiles blocker enforced at publish ─────────────────

describe("Publish route — no investor profiles blocker", () => {
  beforeEach(() => {
    mockPrismaClient.portfolio_snapshots.findUnique.mockReset().mockResolvedValue(null);
    mockPrismaClient.portfolio_snapshots.update.mockReset().mockResolvedValue({});
    vi.mocked(getSession).mockResolvedValue(
      { role: "admin", email: "admin@test.com" } as Awaited<ReturnType<typeof getSession>>
    );
  });

  it("(6) rejects draft when deterministic_checks contains no-investor-profiles blocker", async () => {
    const frozenPayload = makeFrozenPayload({ overlaysFrozen: true });
    mockPrismaClient.portfolio_snapshots.findUnique.mockResolvedValueOnce({
      id: BigInt(55),
      as_of_date: new Date("2025-03-31"),
      publication_status: "draft",
      payload: frozenPayload,
      deterministic_checks: [
        {
          severity: "blocker",
          title: "No investor profiles configured",
          detail: "At least one active investor profile is required to calculate per-investor performance metrics.",
        },
      ],
    });

    const req = new Request("http://localhost/api/admin/publish-snapshot", {
      method: "POST",
      body: JSON.stringify({ snapshotId: 55 }),
      headers: { "content-type": "application/json" },
    });

    const response = await publishPost(req as Parameters<typeof publishPost>[0]);
    expect(response.status).toBe(409);
    const json = (await response.json()) as { error: string; blockers: { title: string }[] };
    expect(json.blockers).toHaveLength(1);
    expect(json.blockers[0].title).toBe("No investor profiles configured");
  });
});

// ─── Test 7: Frozen CEO seed payload bypasses live investor_profiles reads ────

describe("Frozen CEO seed snapshot — dashboard immutability", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaClient.investor_profiles.findMany.mockReset().mockResolvedValue([]);
  });

  it("(7) frozen CEO seed snapshot never re-reads investor_profiles after publish", async () => {
    const frozen = makeFrozenPayload({
      overlaysFrozen: true,
      overlaySources: {
        capitalCommitted: 1_800_000,
        nonListedValue: 200_000,
        externalCash: 0,
        overlayItemCount: 0,
        investorProfileCount: 1,
        manualItems: [],
        source: "CEO tracker workbook",
      },
    });
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-03-31", payload: frozen }]);

    const result = await getPortfolioSnapshot();

    // Alice's data is from the frozen workbook import, not from a live DB read.
    expect(result.investorPerformance).toHaveLength(1);
    expect(result.investorPerformance[0].name).toBe("Alice");
    expect(result.investorPerformance[0].navUnitAtSub).toBe(7_200);

    expect(mockPrismaClient.investor_profiles.findMany).not.toHaveBeenCalled();
  });

  it("(8) official .xlsx CEO seed snapshots are not excluded from dashboard reads", async () => {
    const frozen = makeFrozenPayload({ overlaysFrozen: true });
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-03-31", payload: frozen }]);

    await getPortfolioSnapshot();

    const firstSql = String(mockPrismaClient.$queryRaw.mock.calls[0][0]);
    expect(firstSql).not.toContain("%.xlsx%");
    expect(firstSql).not.toContain("%.xlsm%");
    expect(firstSql).toContain("publication_status = 'published'");
  });
});

// ─── Test 9: CEO seed prepares next monthly Directa upload defaults ──────────

describe("CEO tracker workbook seed — monthly upload defaults", () => {
  it("(9) creates admin controls and manual non-Directa defaults transactionally", async () => {
    const wb = makeWorkbookData();
    wb.manualItems = [
      {
        itemKey: "TRACKER_PARTICIPATION_ALPHA",
        displayName: "Alpha",
        itemType: "Non-Listed",
        subcategory: "Participation",
        value: 150_000,
        notes: "from workbook",
        sortOrder: 10,
      },
      {
        itemKey: "TRACKER_LOAN_BETA",
        displayName: "Beta",
        itemType: "Non-Listed",
        subcategory: "Private Loan",
        value: 50_000,
        notes: "from workbook",
        sortOrder: 100,
      },
    ];
    const response = await callCeoUpload(wb);
    expect(response.status).toBe(200);

    expect(mockPrismaClient.admin_controls.create).toHaveBeenCalled();

    expect(mockPrismaClient.asset_dictionary.upsert).toHaveBeenCalledTimes(2);

    expect(mockPrismaClient.admin_manual_values.create).toHaveBeenCalledTimes(2);

    const seededKeys = mockPrismaClient.admin_manual_values.create.mock.calls.map(
      (args) => (args[0] as { data: { item_key: string } }).data.item_key
    );
    expect(seededKeys).toEqual(["TRACKER_PARTICIPATION_ALPHA", "TRACKER_LOAN_BETA"]);
  });
});
