import crypto from "node:crypto";
import { getPrisma } from "@/db/prisma";
import {
  formatDateOnly,
  getCashAtCutoff,
  parseCsvFile,
  parsePositionCsvFile,
  type PositionPriceRow,
  type RawRow,
} from "@/lib/directa-preprocess";

type DirectaBatchSummary = {
  id: number;
  filename: string;
  canonicalFilename: string;
  monthEnd: string | null;
  statementRows: number;
  positionRows: number;
  statementCash: number | null;
  hasLendingOrCollateralRows: boolean;
};

export type DirectaSourceData = {
  batches: DirectaBatchSummary[];
  transactions: RawRow[];
  positions: PositionPriceRow[];
};

export type DirectaSyncResult = DirectaBatchSummary & {
  fileHash: string;
  transactions: RawRow[];
  positions: PositionPriceRow[];
};

export type DirectaDuplicateCheck = {
  originalFilename: string;
  canonicalFilename: string;
  duplicateKind: "exact_file" | "same_name";
  batchId: number;
  filename: string;
  monthEnd: string | null;
  uploadedAt: string;
  status: string;
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function canonicalCsvFilename(filename: string): string {
  return filename.replace(/\s+\(\d+\)(?=\.csv$)/i, "");
}

export function directaFileHash(content: string): string {
  return sha256(content);
}

export function monthEndFromFilename(filename: string): string | null {
  const m1 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = filename.match(/Ec(?:_?30|_?31)?_(\d{1,2})_(\d{4})/i);
  if (m2) {
    const month = parseInt(m2[1], 10);
    const year = parseInt(m2[2], 10);
    const last = new Date(year, month, 0);
    return formatDateOnly(last);
  }
  return null;
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return formatDateOnly(value);
  return value.includes("T") ? value.split("T")[0] : value;
}

function hasLendingOrCollateralRows(content: string): boolean {
  return /fondi a garanzia|titoli prestati|titoli resi|totale/i.test(content);
}

function latestFileDate(rows: RawRow[], fallback: string | null): Date | null {
  const dates = rows.map((row) => row.fileDate).filter((date): date is Date => date !== null);
  if (dates.length > 0) return dates.reduce((a, b) => (a >= b ? a : b));
  return fallback ? parseDateOnly(fallback) : null;
}

export async function syncDirectaCsvFile({
  fileName,
  content,
  monthEnd,
  uploadedBy,
}: {
  fileName: string;
  content: string;
  monthEnd: string | null;
  uploadedBy: string;
}): Promise<DirectaSyncResult> {
  const prisma = getPrisma();
  const canonicalFilename = canonicalCsvFilename(fileName);
  const effectiveMonthEnd = monthEnd ?? monthEndFromFilename(fileName);
  const fileHash = directaFileHash(content);
  const fallbackFileDate = effectiveMonthEnd ? parseDateOnly(effectiveMonthEnd) : null;
  const transactionRows = parseCsvFile(content, canonicalFilename).map((row) => (
    row.fileDate || !fallbackFileDate ? row : { ...row, fileDate: fallbackFileDate }
  ));
  const positionRows = parsePositionCsvFile(content, canonicalFilename)
    .filter((row) => row.quantity > 0 || row.marketValue > 0)
    .map((row) => (row.fileDate || !fallbackFileDate ? row : { ...row, fileDate: fallbackFileDate }));
  const cutoff = latestFileDate(transactionRows, effectiveMonthEnd);
  const statementCash = transactionRows.length > 0 && cutoff
    ? getCashAtCutoff(transactionRows, cutoff)
    : null;

  const rawFile = await prisma.directa_csv_files.upsert({
    where: { filename: canonicalFilename },
    create: {
      filename: canonicalFilename,
      month_end: effectiveMonthEnd ? parseDateOnly(effectiveMonthEnd) : null,
      content,
    },
    update: {
      month_end: effectiveMonthEnd ? parseDateOnly(effectiveMonthEnd) : null,
      content,
      uploaded_at: new Date(),
    },
    select: { id: true },
  });

  await prisma.directa_upload_batches.updateMany({
    where: {
      canonical_filename: canonicalFilename,
      file_hash: { not: fileHash },
      status: "imported",
    },
    data: { status: "superseded" },
  });

  const batch = await prisma.directa_upload_batches.upsert({
    where: { file_hash: fileHash },
    create: {
      filename: fileName,
      canonical_filename: canonicalFilename,
      file_hash: fileHash,
      month_end: effectiveMonthEnd ? parseDateOnly(effectiveMonthEnd) : null,
      uploaded_by: uploadedBy,
      status: "imported",
      transaction_row_count: transactionRows.length,
      position_row_count: positionRows.length,
      has_lending_or_collateral_rows: hasLendingOrCollateralRows(content),
      statement_cash: statementCash,
      raw_file_id: rawFile.id,
    },
    update: {
      filename: fileName,
      canonical_filename: canonicalFilename,
      month_end: effectiveMonthEnd ? parseDateOnly(effectiveMonthEnd) : null,
      uploaded_by: uploadedBy,
      uploaded_at: new Date(),
      status: "imported",
      transaction_row_count: transactionRows.length,
      position_row_count: positionRows.length,
      has_lending_or_collateral_rows: hasLendingOrCollateralRows(content),
      statement_cash: statementCash,
      raw_file_id: rawFile.id,
    },
    select: { id: true },
  });

  return {
    id: Number(batch.id),
    filename: fileName,
    canonicalFilename,
    monthEnd: effectiveMonthEnd,
    statementRows: transactionRows.length,
    positionRows: positionRows.length,
    statementCash,
    hasLendingOrCollateralRows: hasLendingOrCollateralRows(content),
    fileHash,
    transactions: transactionRows,
    positions: positionRows,
  };
}

export async function checkDirectaCsvDuplicate({
  fileName,
  content,
}: {
  fileName: string;
  content: string;
}): Promise<DirectaDuplicateCheck | null> {
  const prisma = getPrisma();
  const canonicalFilename = canonicalCsvFilename(fileName);
  const fileHash = directaFileHash(content);

  const exact = await prisma.directa_upload_batches.findUnique({
    where: { file_hash: fileHash },
    select: {
      id: true,
      filename: true,
      canonical_filename: true,
      month_end: true,
      uploaded_at: true,
      status: true,
    },
  });
  if (exact) {
    return {
      originalFilename: fileName,
      canonicalFilename: exact.canonical_filename,
      duplicateKind: "exact_file",
      batchId: Number(exact.id),
      filename: exact.filename,
      monthEnd: dateOnly(exact.month_end),
      uploadedAt: exact.uploaded_at.toISOString(),
      status: exact.status,
    };
  }

  const sameName = await prisma.directa_upload_batches.findFirst({
    where: {
      canonical_filename: canonicalFilename,
      status: "imported",
    },
    orderBy: { uploaded_at: "desc" },
    select: {
      id: true,
      filename: true,
      canonical_filename: true,
      month_end: true,
      uploaded_at: true,
      status: true,
    },
  });
  if (!sameName) return null;

  return {
    originalFilename: fileName,
    canonicalFilename: sameName.canonical_filename,
    duplicateKind: "same_name",
    batchId: Number(sameName.id),
    filename: sameName.filename,
    monthEnd: dateOnly(sameName.month_end),
    uploadedAt: sameName.uploaded_at.toISOString(),
    status: sameName.status,
  };
}

export function buildDirectaSourceData(
  syncedFiles: DirectaSyncResult[],
  previousCutoffDate: string | null
): DirectaSourceData {
  const cutoff = previousCutoffDate ? parseDateOnly(previousCutoffDate) : null;
  const included = syncedFiles.filter((file) => {
    if (!cutoff || !file.monthEnd) return true;
    return parseDateOnly(file.monthEnd) > cutoff;
  });
  return {
    batches: included.map((file) => ({
      id: file.id,
      filename: file.filename,
      canonicalFilename: file.canonicalFilename,
      monthEnd: file.monthEnd,
      statementRows: file.statementRows,
      positionRows: file.positionRows,
      statementCash: file.statementCash,
      hasLendingOrCollateralRows: file.hasLendingOrCollateralRows,
    })),
    transactions: included.flatMap((file) => file.transactions),
    positions: included.flatMap((file) => file.positions),
  };
}
