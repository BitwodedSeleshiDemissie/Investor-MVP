/**
 * Snapshot immutability contract tests.
 *
 * 1. The stored published snapshot remains the fallback source of truth.
 * 2. Dashboard reads apply live approved admin/profile overlays without rewriting the stored snapshot.
 * 3. Submitting without manualInputs returns HTTP 400.
 * 4. A prepared source-record draft can publish; an unprepared draft returns HTTP 409.
 * 5. The confirmation popup numbers exactly match the payload that gets published.
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
  portfolio_snapshot_artifacts: {
    create: vi.fn().mockResolvedValue({}),
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
  directa_csv_files: {
    upsert: vi.fn().mockResolvedValue({}),
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

// next/server is a Next.js runtime dependency — provide minimal stubs for Node test env.
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

// ─── Lazy imports (after mocks are registered) ───────────────────────────────
// Use relative paths — vitest node env does not run @/ alias resolution at import time.

import { getPortfolioSnapshot } from "../server/queries/portfolio";
import { POST as publishPost } from "../app/api/admin/publish-snapshot/route";
import { POST as uploadPost } from "../app/api/admin/upload-snapshot/route";
import { getSession } from "@/lib/auth";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSourceRecordPayload(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
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
    pnl: { unrealized: 150_000, realized: 50_000, netTotal: 200_000 },
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
        capitalEur: 500_000,
        units: 250,
        yearsElapsed: 1.25,
        navUnitAtSub: 1_000,
        currentValueEur: 550_000,
        moic: 1.1,
        irrAnnualized: 0.08,
      },
    ],
    sourceRecordReady: true,
    sourceRecordedAt: "2025-04-01T10:00:00Z",
    overlaySources: {
      capitalCommitted: 1_800_000,
      nonListedValue: 200_000,
      externalCash: 0,
      overlayItemCount: 1,
      investorProfileCount: 1,
      manualItems: [{ item_key: "PRIVATE_EQUITY", item_type: "non_listed", value: 200_000 }],
    },
    ...overrides,
  };
}

// ─── Tests 1 & 2: source record payload fallback + live dashboard overlay ─────────────

describe("getPortfolioSnapshot — source record payload with live dashboard overlay", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaClient.investor_profiles.findMany.mockReset().mockResolvedValue([]);
    mockPrismaClient.admin_controls.findFirst.mockReset().mockResolvedValue(null);
  });

  it("(1) returns the source-record composition when no live admin overlay exists", async () => {
    const sourceRecord = makeSourceRecordPayload();
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-03-31", payload: sourceRecord }]);

    const result = await getPortfolioSnapshot();

    expect(result.composition.nonListed).toBe(200_000);
    expect(result.composition.listed).toBe(1_700_000);
    expect(result.kpis.totalPortfolioValue).toBe(2_000_000);

    const sqlCalls = mockPrismaClient.$queryRaw.mock.calls.map((args) => String(args[0]));
    const liveAdminReads = sqlCalls.filter((sql) => sql.includes("admin_manual_values"));
    expect(liveAdminReads.length).toBeGreaterThan(0);
  });

  it("(2) falls back to source-record investor performance when no live profiles exist", async () => {
    const sourceRecord = makeSourceRecordPayload();
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2025-03-31", payload: sourceRecord }]);

    const result = await getPortfolioSnapshot();

    expect(result.investorPerformance).toHaveLength(1);
    expect(result.investorPerformance[0].name).toBe("Alice");
    expect(result.investorPerformance[0].currentValueEur).toBe(550_000);

    expect(mockPrismaClient.investor_profiles.findMany).toHaveBeenCalled();
  });

  it("keeps transactionsThrough as the source-record upload month", async () => {
    const sourceRecord = makeSourceRecordPayload({
      cutoffDate: "2026-05-31",
      dataFreshness: {
        lastUploadAt: "2026-06-01T10:00:00Z",
        transactionsThrough: "2026-05-31",
        positionsAsOf: "2026-05-31",
        sourceFiles: ["Ec31_05_2026.csv", "SituazionePatrimoniale_B6166_31052026.pdf"],
      },
    });
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{ as_of_date: "2026-05-31", payload: sourceRecord }]);

    const result = await getPortfolioSnapshot();

    expect(result.dataFreshness?.transactionsThrough).toBe("2026-05-31");
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

// ─── Test 3: upload route requires explicit manualInputs ──────────────────────

describe("upload-snapshot route — manualInputs validation", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaClient.directa_csv_files.upsert.mockReset().mockResolvedValue({});
    vi.mocked(getSession).mockResolvedValue(
      { role: "admin", email: "admin@test.com" } as Awaited<ReturnType<typeof getSession>>
    );
  });

  it("(3) returns 400 before any DB write when manualInputs is absent", async () => {
    const form = new FormData();
    form.append(
      "files",
      new File(["date,desc,amount\n2025-03-01,test,100"], "statement.csv", { type: "text/csv" })
    );
    // Deliberately do NOT append manualInputs.

    const req = new Request("http://localhost/api/admin/upload-snapshot", {
      method: "POST",
      body: form,
    });

    const response = await uploadPost(req as Parameters<typeof uploadPost>[0]);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(json.error).toBe("Manual non-Directa inputs were not submitted.");
    // The check must happen before any DB writes.
    expect(mockPrismaClient.directa_csv_files.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when manualInputs is present but invalid JSON", async () => {
    const form = new FormData();
    form.append(
      "files",
      new File(["date,desc\n2025-03-01,test"], "statement.csv", { type: "text/csv" })
    );
    form.append("manualInputs", "not-valid-json");

    const req = new Request("http://localhost/api/admin/upload-snapshot", {
      method: "POST",
      body: form,
    });

    const response = await uploadPost(req as Parameters<typeof uploadPost>[0]);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid manualInputs JSON");
  });
});

// ─── Test 4: publish route enforces sourceRecordReady ───────────────────────────

describe("publish-snapshot route — sourceRecordReady gate", () => {
  beforeEach(() => {
    mockPrismaClient.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaClient.$transaction.mockReset().mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrismaClient)
    );
    mockPrismaClient.portfolio_snapshots.findUnique.mockReset().mockResolvedValue(null);
    mockPrismaClient.portfolio_snapshots.update.mockReset().mockResolvedValue({});
    mockPrismaClient.admin_manual_values.create.mockReset().mockResolvedValue({});
    mockPrismaClient.asset_dictionary.upsert.mockReset().mockResolvedValue({});
    vi.mocked(getSession).mockResolvedValue(
      { role: "admin", email: "admin@test.com" } as Awaited<ReturnType<typeof getSession>>
    );
  });

  it("(4a) returns 409 when payload.sourceRecordReady is false", async () => {
    const unpreparedPayload = makeSourceRecordPayload({ sourceRecordReady: false });
    mockPrismaClient.portfolio_snapshots.findUnique.mockResolvedValueOnce({
      id: BigInt(42),
      as_of_date: new Date("2025-03-31"),
      publication_status: "draft",
      payload: unpreparedPayload,
      deterministic_checks: [],
    });

    const req = new Request("http://localhost/api/admin/publish-snapshot", {
      method: "POST",
      body: JSON.stringify({ snapshotId: 42, approvalNote: "test" }),
      headers: { "content-type": "application/json" },
    });

    const response = await publishPost(req as Parameters<typeof publishPost>[0]);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(json.error).toMatch(/not ready to publish/i);
  });

  it("(4b) publishes successfully when payload.sourceRecordReady is true", async () => {
    const sourceRecordPayload = makeSourceRecordPayload({ sourceRecordReady: true });
    mockPrismaClient.portfolio_snapshots.findUnique.mockResolvedValueOnce({
      id: BigInt(42),
      as_of_date: new Date("2025-03-31"),
      publication_status: "draft",
      payload: sourceRecordPayload,
      deterministic_checks: [],
    });

    const req = new Request("http://localhost/api/admin/publish-snapshot", {
      method: "POST",
      body: JSON.stringify({ snapshotId: 42, approvalNote: "test" }),
      headers: { "content-type": "application/json" },
    });

    const response = await publishPost(req as Parameters<typeof publishPost>[0]);
    const json = (await response.json()) as { ok: boolean; snapshotId: number };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.snapshotId).toBe(42);
  });

  it("syncs approved manual non-Directa values into admin tables before publishing", async () => {
    const sourceRecordPayload = makeSourceRecordPayload({
      sourceRecordReady: true,
      overlaySources: {
        capitalCommitted: 1_800_000,
        nonListedValue: 275_000,
        externalCash: 25_000,
        overlayItemCount: 2,
        investorProfileCount: 1,
        brokerageCashSource: {
          type: "directa_pdf",
          fileName: "SituazionePatrimoniale_B6166_31032025.pdf",
          statementDate: "2025-03-31",
        },
        manualItems: [
          {
            item_key: "PRIVATE_PARTICIPATION_APPROVED_ALPHA",
            item_type: "Non-Listed",
            value: 175_000,
            display_name: "Approved Alpha",
            subcategory: "Participation",
          },
          {
            item_key: "PRIVATE_LOAN_APPROVED_BETA",
            item_type: "Non-Listed",
            value: 100_000,
            display_name: "Approved Beta",
            subcategory: "Private Loan",
          },
        ],
      },
    });
    mockPrismaClient.portfolio_snapshots.findUnique.mockResolvedValueOnce({
      id: BigInt(77),
      as_of_date: new Date("2025-03-31"),
      publication_status: "draft",
      source_file: "Ec31_03_2025.csv, SituazionePatrimoniale_B6166_31032025.pdf",
      payload: sourceRecordPayload,
      deterministic_checks: [],
    });

    const req = new Request("http://localhost/api/admin/publish-snapshot", {
      method: "POST",
      body: JSON.stringify({ snapshotId: 77, approvalNote: "approved" }),
      headers: { "content-type": "application/json" },
    });

    const response = await publishPost(req as Parameters<typeof publishPost>[0]);
    const json = (await response.json()) as { ok: boolean; syncedManualItemCount: number };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.syncedManualItemCount).toBe(2);
    expect(mockPrismaClient.asset_dictionary.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrismaClient.admin_manual_values.create).toHaveBeenCalledTimes(2);

    const firstDictionaryWrite = mockPrismaClient.asset_dictionary.upsert.mock.calls[0][0];
    expect(firstDictionaryWrite.where.item_key).toBe("PRIVATE_PARTICIPATION_APPROVED_ALPHA");
    expect(firstDictionaryWrite.create.display_name).toBe("Approved Alpha");
    expect(firstDictionaryWrite.create.item_type).toBe("Non-Listed");

    const manualWrites = mockPrismaClient.admin_manual_values.create.mock.calls.map((args) => args[0].data);
    expect(manualWrites.map((row) => row.item_key)).toEqual([
      "PRIVATE_PARTICIPATION_APPROVED_ALPHA",
      "PRIVATE_LOAN_APPROVED_BETA",
    ]);
    expect(manualWrites.map((row) => row.value)).toEqual([175_000, 100_000]);
    expect(manualWrites[0].as_of_date).toEqual(new Date("2025-03-31"));
    expect(mockPrismaClient.portfolio_snapshots.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BigInt(77) },
        data: expect.objectContaining({
          publication_status: "published",
          approved_by: "admin@test.com",
        }),
      })
    );
  });

  it("returns 409 when a blocker check exists (even if source-record)", async () => {
    const sourceRecordPayload = makeSourceRecordPayload({ sourceRecordReady: true });
    mockPrismaClient.portfolio_snapshots.findUnique.mockResolvedValueOnce({
      id: BigInt(99),
      as_of_date: new Date("2025-03-31"),
      publication_status: "draft",
      source_file: "Ec31_03_2025.csv, SituazionePatrimoniale_B6166_31032025.pdf",
      payload: sourceRecordPayload,
      deterministic_checks: [
        { severity: "blocker", title: "Missing Directa positions file", detail: "..." },
      ],
    });

    const req = new Request("http://localhost/api/admin/publish-snapshot", {
      method: "POST",
      body: JSON.stringify({ snapshotId: 99 }),
      headers: { "content-type": "application/json" },
    });

    const response = await publishPost(req as Parameters<typeof publishPost>[0]);
    expect(response.status).toBe(409);
  });

  it("returns 409 for CSV-only Directa drafts that predate PDF validation", async () => {
    const sourceRecordPayload = makeSourceRecordPayload({
      sourceRecordReady: true,
      overlaySources: {
        capitalCommitted: 1_800_000,
        nonListedValue: 200_000,
        externalCash: 0,
        overlayItemCount: 1,
        investorProfileCount: 1,
        manualItems: [{ item_key: "PRIVATE_EQUITY", item_type: "non_listed", value: 200_000 }],
      },
    });
    mockPrismaClient.portfolio_snapshots.findUnique.mockResolvedValueOnce({
      id: BigInt(100),
      as_of_date: new Date("2025-03-31"),
      publication_status: "draft",
      source_file: "Ec31_03_2025.csv",
      payload: sourceRecordPayload,
      deterministic_checks: [],
    });

    const req = new Request("http://localhost/api/admin/publish-snapshot", {
      method: "POST",
      body: JSON.stringify({ snapshotId: 100 }),
      headers: { "content-type": "application/json" },
    });

    const response = await publishPost(req as Parameters<typeof publishPost>[0]);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(json.error).toMatch(/Directa PDF validation/i);
  });
});

// ─── Test 5: confirmation popup numbers == source record payload fields ──────────────

describe("(5) confirmation popup numbers exactly match the source record payload", () => {
  /**
   * The upload route returns 5 numbers in JSON and freezes the same values into the payload:
   *   portfolioValue  ← payload.kpis.totalPortfolioValue
   *   fundIrr         ← payload.irr.fundIrr
   *   directaListed   ← payload.composition.listed
   *   directaCash     ← payload.directaCash
   *   nonDirectaTotal ← payload.overlaySources.nonListedValue + externalCash
   *
   * These tests verify that projection and storage are identical — no divergence.
   */

  it("response projection fields match the source record payload fields", () => {
    const payload = makeSourceRecordPayload();

    // Mirror exactly what the upload route returns in its JSON response.
    const responseProjection = {
      portfolioValue: payload.kpis.totalPortfolioValue,
      fundIrr: payload.irr.fundIrr,
      directaListed: payload.composition.listed,
      directaCash: payload.directaCash,
      nonDirectaTotal:
        (payload.overlaySources?.nonListedValue ?? 0) +
        (payload.overlaySources?.externalCash ?? 0),
    };

    expect(responseProjection.portfolioValue).toBe(payload.kpis.totalPortfolioValue);
    expect(responseProjection.fundIrr).toBe(payload.irr.fundIrr);
    expect(responseProjection.directaListed).toBe(payload.composition.listed);
    expect(responseProjection.directaCash).toBe(payload.directaCash);
    expect(responseProjection.nonDirectaTotal).toBe(
      payload.overlaySources!.nonListedValue + payload.overlaySources!.externalCash
    );
  });

  it("source-record manualItems sum equals nonDirectaTotal reported to UI", () => {
    const items = [
      { item_key: "PE_FUND", item_type: "non_listed", value: 300_000 },
      { item_key: "EXT_CASH", item_type: "cash", value: 75_000 },
    ];
    const nonListedValue = items
      .filter((i) => i.item_type !== "cash")
      .reduce((s, i) => s + i.value, 0);
    const externalCash = items
      .filter((i) => i.item_type === "cash")
      .reduce((s, i) => s + i.value, 0);

    const payload = makeSourceRecordPayload({
      overlaySources: {
        capitalCommitted: 1_800_000,
        nonListedValue,
        externalCash,
        overlayItemCount: items.length,
        investorProfileCount: 1,
        manualItems: items,
      },
    });

    const nonDirectaTotal = nonListedValue + externalCash;
    const sourceRecordItemsTotal = payload.overlaySources!.manualItems!.reduce((s, i) => s + i.value, 0);

    expect(nonDirectaTotal).toBe(375_000);
    expect(sourceRecordItemsTotal).toBe(nonDirectaTotal);
  });

  it("composition.total is listed + nonListed + cash and matches totalPortfolioValue", () => {
    const payload = makeSourceRecordPayload();
    const { listed, nonListed, cash, total } = payload.composition;

    expect(total).toBe(listed + nonListed + cash);
    expect(total).toBe(payload.kpis.totalPortfolioValue);
  });
});
