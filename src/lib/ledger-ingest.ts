import type { PrismaClient } from "@/generated/prisma/client";
import type { DirectaLiquidityPdf } from "./directa-pdf";
import { parseCsvFile } from "./directa-preprocess";

// ── Types ─────────────────────────────────────────────────────────────────────

export type IngestSkipReason =
  | "non-ledger row type"
  | "unknown security alias (income)"
  | "orphan income (no trade history for ISIN)"
  | "blank reference";

export type IngestSkippedRow = {
  sourceFile: string;
  rowNumber: number;
  tradeDate: string;
  security: string;
  csvType: string;
  reason: IngestSkipReason;
};

export type IngestResult = {
  securityUpserts: number;
  aliasUpserts: number;
  transactionsInserted: number;
  feeRowsInserted: number;
  skipped: IngestSkippedRow[];
  blockedNames: string[];
};

// ── CSV type → Transaction enum mapping ───────────────────────────────────────

type LedgerTxType = "BUY" | "SELL" | "DIVIDEND" | "INTEREST" | "COUPON" | "ETF_INCOME" | "FEE";

const CSV_TYPE_MAP: Record<string, LedgerTxType | null> = {
  Buy: "BUY",
  Sell: "SELL",
  Dividend: "DIVIDEND",
  "Sec. Lending": "INTEREST",
  Coupon: "COUPON",
  Distribution: "ETF_INCOME",
  // Non-ledger row types — skip silently.
  Balance: null,
  Deposit: null,
  Withdrawal: null,
  Tax: null,
  Redemption: "SELL", // bond maturity: reduces position, treated as SELL
  Other: null,
};

function isIncomeType(t: LedgerTxType): boolean {
  return t === "DIVIDEND" || t === "INTEREST" || t === "COUPON" || t === "ETF_INCOME";
}

// ── Asset class inference (mirrors seed script) ───────────────────────────────

type AssetClass = "EQUITY" | "ETF" | "BOND" | "ETC";
type PriceConvention = "STRAIGHT" | "DECIMAL_FRACTION";

function inferAssetClass(name: string): AssetClass {
  const u = name.toUpperCase();
  if (u.includes("BTP") || u.includes("BOT ") || u.startsWith("BOT") || u.includes("FINANCE FX") || /\d+[.,]\d+%/.test(name)) return "BOND";
  if (u.includes("PHYSICAL") || u.includes("BITWISE") || u.includes("SOLANA") || u.includes("BITCOIN") || u.includes("ETHEREUM")) return "ETC";
  if (u.includes("ETF") || u.includes("UCITS") || u.includes("ISHARES") || u.includes("AMUNDI") || u.includes("VANECK") || u.includes("WISDOMTREE")) return "ETF";
  return "EQUITY";
}

function priceConventionFor(ac: AssetClass): PriceConvention {
  return ac === "BOND" ? "DECIMAL_FRACTION" : "STRAIGHT";
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function ingestFromCsv(
  prisma: PrismaClient,
  csvContent: string,
  csvFilename: string,
  pdf: DirectaLiquidityPdf
): Promise<IngestResult> {
  const result: IngestResult = {
    securityUpserts: 0,
    aliasUpserts: 0,
    transactionsInserted: 0,
    feeRowsInserted: 0,
    skipped: [],
    blockedNames: [],
  };

  // ── Step 1: Upsert Security + SecurityAlias from PDF (authoritative source) ──

  for (const pos of pdf.positions) {
    if (!pos.isin) continue;
    const ac = inferAssetClass(pos.security);
    await prisma.security.upsert({
      where: { isin: pos.isin },
      create: { isin: pos.isin, name: pos.security, currency: "EUR", assetClass: ac, priceConvention: priceConventionFor(ac) },
      update: { name: pos.security },
    });
    result.securityUpserts++;

    await prisma.securityAlias.upsert({
      where: { rawName: pos.security },
      create: { rawName: pos.security, isin: pos.isin },
      update: { isin: pos.isin },
    });
    result.aliasUpserts++;
  }

  // ── Step 2: Build alias lookup (case-insensitive, covers Excel + PDF names) ──

  const allAliases = await prisma.securityAlias.findMany({
    select: { rawName: true, isin: true },
  });
  // Lower-case key → ISIN; last entry wins for duplicates (shouldn't exist).
  const aliasMap = new Map<string, string>();
  for (const a of allAliases) {
    aliasMap.set(a.rawName.toLowerCase().trim(), a.isin);
  }

  // Build set of ISINs that have at least one BUY/OPENING/SELL trade for orphan check.
  const tradedIsins = new Set<string>(
    (
      await prisma.transaction.findMany({
        where: { type: { in: ["BUY", "OPENING", "SELL"] }, securityIsin: { not: null } },
        select: { securityIsin: true },
        distinct: ["securityIsin"],
      })
    ).map((r) => r.securityIsin!)
  );

  // ── Step 3: Parse CSV rows ────────────────────────────────────────────────────

  const rawRows = parseCsvFile(csvContent, csvFilename);
  const blockedSet = new Set<string>();

  const txData: Array<Parameters<typeof prisma.transaction.create>[0]["data"]> = [];

  for (const row of rawRows) {
    const rowNum = row.rowNumber ?? 0;
    const csvTypeStr = row.type;
    const tradeDate = row.date.toISOString().slice(0, 10);
    const reference = row.reference?.trim() ?? "";

    if (!reference) {
      result.skipped.push({ sourceFile: csvFilename, rowNumber: rowNum, tradeDate, security: row.security, csvType: csvTypeStr, reason: "blank reference" });
      continue;
    }

    const ledgerType: LedgerTxType | null | undefined = CSV_TYPE_MAP[csvTypeStr];
    if (ledgerType === null || ledgerType === undefined) {
      result.skipped.push({ sourceFile: csvFilename, rowNumber: rowNum, tradeDate, security: row.security, csvType: csvTypeStr, reason: "non-ledger row type" });
      continue;
    }

    // Resolve ISIN via SecurityAlias (case-insensitive).
    const securityNameLower = row.security.toLowerCase().trim();
    const isin = aliasMap.get(securityNameLower) ?? null;

    if (!isin) {
      if (isIncomeType(ledgerType)) {
        result.skipped.push({ sourceFile: csvFilename, rowNumber: rowNum, tradeDate, security: row.security, csvType: csvTypeStr, reason: "unknown security alias (income)" });
      } else {
        // BUY or SELL with no known alias — hard block.
        blockedSet.add(row.security);
      }
      continue;
    }

    // Orphan income check.
    if (isIncomeType(ledgerType) && !tradedIsins.has(isin)) {
      result.skipped.push({ sourceFile: csvFilename, rowNumber: rowNum, tradeDate, security: row.security, csvType: csvTypeStr, reason: "orphan income (no trade history for ISIN)" });
      continue;
    }

    const eurAmountRaw = Math.abs(row.amount ?? 0);
    const qty = Math.abs(row.quantity ?? 0);
    const price = row.price ?? 0;

    txData.push({
      externalRef: reference,
      tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
      type: ledgerType,
      securityIsin: isin,
      quantity: isIncomeType(ledgerType) ? "0.000000" : qty.toFixed(6),
      price: isIncomeType(ledgerType) ? "0.00000000" : price.toFixed(8),
      fxRate: "1.00000000",
      eurAmount: eurAmountRaw.toFixed(4),
      commission: "0.0000",
      sourceFile: csvFilename,
      notes: isIncomeType(ledgerType) ? `Income: ${row.security}` : null,
    });

    // FEE row for non-zero commission.
    const commAbs = Math.abs(row.commission ?? 0);
    if (commAbs > 0) {
      txData.push({
        externalRef: `${reference}-COMM`,
        tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
        type: "FEE" as LedgerTxType,
        securityIsin: null,
        quantity: "0.000000",
        price: "0.00000000",
        fxRate: "1.00000000",
        eurAmount: commAbs.toFixed(4),
        commission: "0.0000",
        sourceFile: csvFilename,
        notes: `Commission for ${reference}`,
      });
    }
  }

  result.blockedNames = [...blockedSet];
  if (result.blockedNames.length > 0) {
    // Return early — caller must surface these before any DB writes for the CSV.
    return result;
  }

  // ── Step 4: Write Transactions (idempotent via ON CONFLICT DO NOTHING) ────────

  if (txData.length > 0) {
    // Split main rows from FEE rows to count separately.
    const feeRefs = new Set(txData.filter((r) => r.type === "FEE").map((r) => r.externalRef));
    const mainData = txData.filter((r) => r.type !== "FEE");
    const feeData = txData.filter((r) => r.type === "FEE");

    if (mainData.length > 0) {
      const mainResult = await prisma.transaction.createMany({ data: mainData as never, skipDuplicates: true });
      result.transactionsInserted = mainResult.count;
    }
    if (feeData.length > 0) {
      const feeResult = await prisma.transaction.createMany({ data: feeData as never, skipDuplicates: true });
      result.feeRowsInserted = feeResult.count;
    }
    void feeRefs; // satisfies TS
  }

  return result;
}
