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

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value));
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
  const m2 = filename.match(/Ec(?:_X|30)?_(\d{1,2})_(\d{4})/i);
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

function dbDate(value: Date | string | null | undefined): Date | null {
  const text = dateOnly(value);
  return text ? parseDateOnly(text) : null;
}

function hasLendingOrCollateralRows(content: string): boolean {
  return /fondi a garanzia|titoli prestati|titoli resi|totale/i.test(content);
}

function transactionHash(canonicalFilename: string, rowNumber: number, row: RawRow): string {
  return stableHash({
    kind: "directa_transaction",
    canonicalFilename,
    rowNumber,
    date: formatDateOnly(row.date),
    settlement: dateOnly(row.settlement),
    security: row.security,
    reference: row.reference,
    type: row.type,
    price: row.price,
    currency: row.currency,
    quantity: row.quantity,
    amount: row.amount,
    commission: row.commission,
  });
}

function positionHash(canonicalFilename: string, rowNumber: number, row: PositionPriceRow): string {
  return stableHash({
    kind: "directa_position",
    canonicalFilename,
    rowNumber,
    fileDate: dateOnly(row.fileDate),
    security: row.security,
    quantity: row.quantity,
    price: row.price,
    marketValue: row.marketValue,
  });
}

function cashHash(canonicalFilename: string, monthEnd: string | null, statementCash: number): string {
  return stableHash({
    kind: "directa_cash_balance",
    canonicalFilename,
    monthEnd,
    statementCash,
  });
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
  const transactionRows = parseCsvFile(content, canonicalFilename);
  const positionRows = parsePositionCsvFile(content, canonicalFilename).filter(
    (row) => row.quantity > 0 || row.marketValue > 0
  );
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

  if (transactionRows.length > 0) {
    await prisma.directa_transactions.createMany({
      data: transactionRows.map((row, index) => ({
        upload_batch_id: batch.id,
        row_number: index + 1,
        row_hash: transactionHash(canonicalFilename, index + 1, row),
        source_file: canonicalFilename,
        file_date: dbDate(row.fileDate),
        trade_date: dbDate(row.date)!,
        settlement_date: dbDate(row.settlement),
        security_name: row.security,
        reference: row.reference,
        transaction_type: row.type,
        tipo: row.tipo,
        price: row.price,
        currency: row.currency || "EUR",
        quantity: row.quantity,
        amount: row.amount,
        commission: row.commission,
      })),
      skipDuplicates: true,
    });
  }

  if (positionRows.length > 0) {
    await prisma.directa_positions.createMany({
      data: positionRows.map((row, index) => ({
        upload_batch_id: batch.id,
        row_number: index + 1,
        row_hash: positionHash(canonicalFilename, index + 1, row),
        source_file: canonicalFilename,
        file_date: dbDate(row.fileDate),
        month_end: effectiveMonthEnd ? parseDateOnly(effectiveMonthEnd) : dbDate(row.fileDate),
        security_name: row.security,
        quantity: row.quantity,
        price: row.price,
        market_value: row.marketValue,
      })),
      skipDuplicates: true,
    });
  }

  if (statementCash !== null) {
    await prisma.directa_cash_balances.createMany({
      data: [{
        upload_batch_id: batch.id,
        row_hash: cashHash(canonicalFilename, effectiveMonthEnd, statementCash),
        source_file: canonicalFilename,
        month_end: effectiveMonthEnd ? parseDateOnly(effectiveMonthEnd) : cutoff,
        statement_cash: statementCash,
      }],
      skipDuplicates: true,
    });
  }

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

export async function readDirectaSourceDataAfterCutoff(
  previousCutoffDate: string | null
): Promise<DirectaSourceData> {
  const prisma = getPrisma();
  const cutoff = previousCutoffDate ? parseDateOnly(previousCutoffDate) : null;
  const batches = await prisma.directa_upload_batches.findMany({
    where: {
      status: "imported",
      ...(cutoff
        ? { OR: [{ month_end: null }, { month_end: { gt: cutoff } }] }
        : {}),
    },
    orderBy: [{ month_end: "asc" }, { uploaded_at: "asc" }, { filename: "asc" }],
    select: {
      id: true,
      filename: true,
      canonical_filename: true,
      month_end: true,
      transaction_row_count: true,
      position_row_count: true,
      statement_cash: true,
      has_lending_or_collateral_rows: true,
    },
  });

  const batchIds = batches.map((batch) => batch.id);
  if (batchIds.length === 0) {
    return { batches: [], transactions: [], positions: [] };
  }

  const [transactions, positions] = await Promise.all([
    prisma.directa_transactions.findMany({
      where: { upload_batch_id: { in: batchIds } },
      orderBy: [{ trade_date: "asc" }, { upload_batch_id: "asc" }, { row_number: "asc" }],
    }),
    prisma.directa_positions.findMany({
      where: { upload_batch_id: { in: batchIds } },
      orderBy: [{ month_end: "asc" }, { upload_batch_id: "asc" }, { row_number: "asc" }],
    }),
  ]);

  return {
    batches: batches.map((batch) => ({
      id: Number(batch.id),
      filename: batch.filename,
      canonicalFilename: batch.canonical_filename,
      monthEnd: dateOnly(batch.month_end),
      statementRows: batch.transaction_row_count,
      positionRows: batch.position_row_count,
      statementCash: batch.statement_cash,
      hasLendingOrCollateralRows: batch.has_lending_or_collateral_rows,
    })),
    transactions: transactions.map((row): RawRow => ({
      sourceFile: row.source_file,
      fileDate: dbDate(row.file_date),
      date: dbDate(row.trade_date)!,
      settlement: dbDate(row.settlement_date),
      security: row.security_name,
      reference: row.reference,
      price: row.price,
      currency: row.currency,
      quantity: row.quantity,
      amount: row.amount,
      commission: row.commission,
      type: row.transaction_type,
      tipo: row.tipo as RawRow["tipo"],
    })),
    positions: positions.map((row): PositionPriceRow => ({
      sourceFile: row.source_file,
      fileDate: dbDate(row.file_date),
      security: row.security_name,
      quantity: row.quantity,
      price: row.price,
      marketValue: row.market_value,
    })),
  };
}
