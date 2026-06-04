import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrismaClient = vi.hoisted(() => ({
  directa_upload_batches: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/db/prisma", () => ({
  getPrisma: () => mockPrismaClient,
}));

import {
  buildDirectaSourceData,
  checkDirectaCsvDuplicate,
  type DirectaSyncResult,
} from "../server/directa-ingestion";

describe("Directa ingestion duplicate checks", () => {
  beforeEach(() => {
    mockPrismaClient.directa_upload_batches.findUnique.mockReset().mockResolvedValue(null);
    mockPrismaClient.directa_upload_batches.findFirst.mockReset().mockResolvedValue(null);
    mockPrismaClient.directa_upload_batches.findMany.mockReset().mockResolvedValue([]);
  });

  it("returns exact_file when the uploaded CSV hash already exists", async () => {
    mockPrismaClient.directa_upload_batches.findUnique.mockResolvedValueOnce({
      id: BigInt(12),
      filename: "Ec31_03_2026.csv",
      canonical_filename: "Ec31_03_2026.csv",
      month_end: new Date("2026-03-31T00:00:00Z"),
      uploaded_at: new Date("2026-04-01T10:00:00Z"),
      status: "imported",
    });

    const result = await checkDirectaCsvDuplicate({
      fileName: "Ec31_03_2026.csv",
      content: "same file contents",
    });

    expect(result).toEqual({
      originalFilename: "Ec31_03_2026.csv",
      canonicalFilename: "Ec31_03_2026.csv",
      duplicateKind: "exact_file",
      batchId: 12,
      filename: "Ec31_03_2026.csv",
      monthEnd: "2026-03-31",
      uploadedAt: "2026-04-01T10:00:00.000Z",
      status: "imported",
    });
    expect(mockPrismaClient.directa_upload_batches.findFirst).not.toHaveBeenCalled();
  });

  it("builds source data from current upload rows without DB row reads", () => {
    const uploaded = makeSyncedUpload({ monthEnd: "2026-03-31" });
    const result = buildDirectaSourceData([uploaded], "2026-02-28");

    expect(result.batches).toEqual([
      expect.objectContaining({ id: 12, canonicalFilename: "Ec31_03_2026.csv" }),
    ]);
    expect(result.transactions).toHaveLength(1);
    expect(result.positions).toHaveLength(1);
    expect(mockPrismaClient.directa_upload_batches.findMany).not.toHaveBeenCalled();
  });

  it("filters out uploads that do not advance beyond the previous cutoff", () => {
    const result = buildDirectaSourceData(
      [makeSyncedUpload({ id: 12, monthEnd: "2026-02-28" })],
      "2026-02-28"
    );

    expect(result).toEqual({ batches: [], transactions: [], positions: [] });
    expect(mockPrismaClient.directa_upload_batches.findMany).not.toHaveBeenCalled();
  });
});

function makeSyncedUpload(overrides: Partial<DirectaSyncResult> = {}): DirectaSyncResult {
  const transactionDate = new Date("2026-03-31T00:00:00Z");
  return {
    id: 12,
    filename: "Ec31_03_2026.csv",
    canonicalFilename: "Ec31_03_2026.csv",
    monthEnd: "2026-03-31",
    statementRows: 1,
    positionRows: 1,
    statementCash: 1000,
    hasLendingOrCollateralRows: false,
    fileHash: "hash",
    transactions: [{
      sourceFile: "Ec31_03_2026.csv",
      rowNumber: 1,
      fileDate: transactionDate,
      date: transactionDate,
      settlement: null,
      security: "ENEL",
      isin: "IT0003128367",
      reference: "Acquisto",
      price: 1,
      currency: "EUR",
      quantity: 10,
      amount: -10,
      commission: 0,
      type: "Buy",
      tipo: null,
    }],
    positions: [{
      sourceFile: "Ec31_03_2026.csv",
      fileDate: transactionDate,
      security: "ENEL",
      isin: "IT0003128367",
      quantity: 10,
      price: 1,
      marketValue: 10,
    }],
    ...overrides,
  };
}
