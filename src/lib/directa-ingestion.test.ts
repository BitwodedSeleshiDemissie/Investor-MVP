import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrismaClient = vi.hoisted(() => ({
  directa_upload_batches: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  directa_transactions: {
    findMany: vi.fn(),
  },
  directa_positions: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/db/prisma", () => ({
  getPrisma: () => mockPrismaClient,
}));

import { checkDirectaCsvDuplicate, readDirectaSourceDataAfterCutoff } from "../server/directa-ingestion";

describe("Directa ingestion duplicate checks", () => {
  beforeEach(() => {
    mockPrismaClient.directa_upload_batches.findUnique.mockReset().mockResolvedValue(null);
    mockPrismaClient.directa_upload_batches.findFirst.mockReset().mockResolvedValue(null);
    mockPrismaClient.directa_upload_batches.findMany.mockReset().mockResolvedValue([]);
    mockPrismaClient.directa_transactions.findMany.mockReset().mockResolvedValue([]);
    mockPrismaClient.directa_positions.findMany.mockReset().mockResolvedValue([]);
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

  it("limits source data reads to the current upload batch ids", async () => {
    const result = await readDirectaSourceDataAfterCutoff("2026-02-28", [12]);

    expect(result).toEqual({ batches: [], transactions: [], positions: [] });
    expect(mockPrismaClient.directa_upload_batches.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [BigInt(12)] },
          status: "imported",
          OR: expect.any(Array),
        }),
      })
    );
  });

  it("returns no source data when an explicit empty batch id list is supplied", async () => {
    const result = await readDirectaSourceDataAfterCutoff("2026-02-28", []);

    expect(result).toEqual({ batches: [], transactions: [], positions: [] });
    expect(mockPrismaClient.directa_upload_batches.findMany).not.toHaveBeenCalled();
  });
});
