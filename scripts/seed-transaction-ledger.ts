import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const WORKBOOK_ENV = "TRANSACTION_LEDGER_WORKBOOK";
const DEFAULT_WORKBOOK = "bootstrap/Ariete_Capital_Investment_Tracker.xlsx";
const SOURCE_FILE = "Ariete_Capital_Investment_Tracker.xlsx";
const CUTOFF = "2026-04-30";
const SECURITY_SOURCE_START_ROW = 5;
const SECURITY_SOURCE_END_ROW = 254;

type TransactionType = "BUY" | "SELL" | "OPENING" | "DIVIDEND" | "INTEREST" | "COUPON" | "FEE" | "ETF_INCOME" | "LOAN_INT";
type AssetClass = "EQUITY" | "ETF" | "BOND" | "ETC";
type PriceConvention = "STRAIGHT" | "DECIMAL_FRACTION";

type SecurityPlan = {
  isin: string;
  name: string;
  currency: string;
  assetClass: AssetClass;
  priceConvention: PriceConvention;
  sourceRows: number[];
};

type SecurityAliasPlan = {
  rawName: string;
  isin: string;
  sourceRows: number[];
};

type TransactionPlan = {
  externalRef: string;
  sourceSheet: string;
  row: number;
  tradeDate: string;
  type: TransactionType;
  securityIsin: string | null;
  quantity: string;
  price: string;
  fxRate: string;
  eurAmount: string;
  commission: string;
  sourceFile: string;
  notes: string | null;
};

type SkipReason =
  | "placeholder ISIN"
  | "date > 2026-04-30"
  | "missing/invalid tradeDate"
  | "missing ISIN"
  | "missing security name"
  | "unmatched securityIsin"
  | "orphan income (no matching security in 04_Trades)"
  | "unsupported transaction type"
  | "missing numeric value";

type SkippedRow = {
  sheet: string;
  row: number;
  reason: SkipReason;
  detail: string;
};

type AliasCollision = {
  rawName: string;
  isins: string[];
};

type NameVariant = {
  isin: string;
  securityName: string;
  aliases: string[];
};

type Plan = {
  workbookPath: string;
  securities: SecurityPlan[];
  aliases: SecurityAliasPlan[];
  transactions: TransactionPlan[];
  skippedRows: SkippedRow[];
  aliasCollisions: AliasCollision[];
  nameVariants: NameVariant[];
};

const VALID_TRANSACTION_TYPES = new Set<TransactionType>([
  "BUY",
  "SELL",
  "OPENING",
  "DIVIDEND",
  "INTEREST",
  "COUPON",
  "FEE",
  "ETF_INCOME",
  "LOAN_INT",
]);

const BLOCKING_SKIP_REASONS = new Set<SkipReason>([
  "missing/invalid tradeDate",
  "missing ISIN",
  "missing security name",
  "unmatched securityIsin",
  "unsupported transaction type",
  "missing numeric value",
]);

function parseArgs(): { apply: boolean; workbookPath: string } {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const workbookArg = args.find((arg) => arg.startsWith("--workbook="));
  const configured = workbookArg?.slice("--workbook=".length) || process.env[WORKBOOK_ENV] || DEFAULT_WORKBOOK;
  const workbookPath = path.resolve(process.cwd(), configured);
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found at ${workbookPath}. Set ${WORKBOOK_ENV} or pass --workbook=...`);
  }
  return { apply, workbookPath };
}

function cell(ws: XLSX.WorkSheet, address: string): XLSX.CellObject | undefined {
  return ws[address] as XLSX.CellObject | undefined;
}

function stringCell(ws: XLSX.WorkSheet, col: string, row: number): string {
  const value = cell(ws, `${col}${row}`)?.v;
  return value === undefined || value === null ? "" : String(value).trim();
}

function rowHasAny(ws: XLSX.WorkSheet, row: number, cols: string[]): boolean {
  return cols.some((col) => stringCell(ws, col, row) !== "");
}

function parseDateCell(ws: XLSX.WorkSheet, col: string, row: number): string | null {
  const value = cell(ws, `${col}${row}`)?.v;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const italian = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (italian) {
      return `${italian[3]}-${italian[2].padStart(2, "0")}-${italian[1].padStart(2, "0")}`;
    }
    const parsed = new Date(trimmed);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseNumberCell(ws: XLSX.WorkSheet, col: string, row: number, scale: number): string | null {
  const value = cell(ws, `${col}${row}`)?.v;
  let numberValue: number;
  if (typeof value === "number") {
    numberValue = value;
  } else if (typeof value === "string" && value.trim()) {
    numberValue = Number(value.trim().replace(/\./g, "").replace(",", "."));
  } else {
    return null;
  }
  if (!Number.isFinite(numberValue)) return null;
  return numberValue.toFixed(scale);
}

function inferAssetClass(name: string): AssetClass {
  const normalized = name.toUpperCase();
  if (normalized.includes("BTP") || normalized.includes("BOT ") || normalized.startsWith("BOT") || normalized.includes("FINANCE FX")) {
    return "BOND";
  }
  if (normalized.includes("PHYSICAL") || normalized.includes("BITWISE") || normalized.includes("SOLANA") || normalized.includes("BITCOIN") || normalized.includes("ETHEREUM")) {
    return "ETC";
  }
  if (
    normalized.includes("ETF") ||
    normalized.includes("UCITS") ||
    normalized.includes("ISHARES") ||
    normalized.includes("AMUNDI") ||
    normalized.includes("VANECK") ||
    normalized.includes("WISDOMTREE")
  ) {
    return "ETF";
  }
  return "EQUITY";
}

function priceConventionFor(assetClass: AssetClass): PriceConvention {
  return assetClass === "BOND" ? "DECIMAL_FRACTION" : "STRAIGHT";
}

function pushSkip(skippedRows: SkippedRow[], sheet: string, row: number, reason: SkipReason, detail: string): void {
  skippedRows.push({ sheet, row, reason, detail });
}

function addSecuritySource(plan: Plan, row: number, name: string, isin: string, currency: string): void {
  const existing = plan.securities.find((security) => security.isin === isin);
  if (existing) {
    existing.sourceRows.push(row);
  } else {
    const assetClass = inferAssetClass(name);
    plan.securities.push({
      isin,
      name,
      currency: currency || "EUR",
      assetClass,
      priceConvention: priceConventionFor(assetClass),
      sourceRows: [row],
    });
  }

  const existingAlias = plan.aliases.find((alias) => alias.rawName === name && alias.isin === isin);
  if (existingAlias) {
    existingAlias.sourceRows.push(row);
  } else {
    plan.aliases.push({ rawName: name, isin, sourceRows: [row] });
  }
}

function buildSecurityPlan(plan: Plan, wb: XLSX.WorkBook): Set<string> {
  const ws = wb.Sheets["04_Trades"];
  if (!ws) throw new Error("Missing required sheet 04_Trades");

  for (let row = SECURITY_SOURCE_START_ROW; row <= SECURITY_SOURCE_END_ROW; row++) {
    const name = stringCell(ws, "D", row);
    const isin = stringCell(ws, "E", row);
    const currency = stringCell(ws, "F", row) || "EUR";
    if (!name && !isin) continue;
    if (!name) {
      pushSkip(plan.skippedRows, "04_Trades security source", row, "missing security name", `Security source row has ISIN ${isin || "(blank)"}`);
      continue;
    }
    if (!isin) {
      pushSkip(plan.skippedRows, "04_Trades security source", row, "missing ISIN", `Security source row has name ${name}`);
      continue;
    }
    if (isin.startsWith("VERIFY-")) {
      pushSkip(plan.skippedRows, "04_Trades security source", row, "placeholder ISIN", `${name} -> ${isin}`);
      continue;
    }
    addSecuritySource(plan, row, name, isin, currency);
  }

  const rawNameToIsins = new Map<string, Set<string>>();
  for (const alias of plan.aliases) {
    const isins = rawNameToIsins.get(alias.rawName) ?? new Set<string>();
    isins.add(alias.isin);
    rawNameToIsins.set(alias.rawName, isins);
  }
  plan.aliasCollisions = [...rawNameToIsins.entries()]
    .filter(([, isins]) => isins.size > 1)
    .map(([rawName, isins]) => ({ rawName, isins: [...isins].sort() }));

  const aliasesByIsin = new Map<string, Set<string>>();
  for (const alias of plan.aliases) {
    const aliases = aliasesByIsin.get(alias.isin) ?? new Set<string>();
    aliases.add(alias.rawName);
    aliasesByIsin.set(alias.isin, aliases);
  }
  plan.nameVariants = plan.securities
    .map((security) => ({
      isin: security.isin,
      securityName: security.name,
      aliases: [...(aliasesByIsin.get(security.isin) ?? new Set<string>())].sort(),
    }))
    .filter((variant) => variant.aliases.length > 1);

  return new Set(plan.securities.map((security) => security.isin));
}

function addTradeTransactions(plan: Plan, wb: XLSX.WorkBook, knownIsins: Set<string>): void {
  const ws = wb.Sheets["04_Trades"];
  if (!ws) throw new Error("Missing required sheet 04_Trades");
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:L1");

  for (let row = 5; row <= range.e.r + 1; row++) {
    if (!rowHasAny(ws, row, ["B", "C", "D", "E", "G", "H", "J", "K"])) continue;

    const tradeDate = parseDateCell(ws, "B", row);
    const rawName = stringCell(ws, "D", row);
    const isin = stringCell(ws, "E", row);
    const rawType = stringCell(ws, "C", row).toUpperCase();

    if (!tradeDate) {
      pushSkip(plan.skippedRows, "04_Trades transactions", row, "missing/invalid tradeDate", rawName || isin || "blank security");
      continue;
    }
    if (tradeDate > CUTOFF) {
      pushSkip(plan.skippedRows, "04_Trades transactions", row, "date > 2026-04-30", `${tradeDate} ${rawName || isin}`);
      continue;
    }
    if (isin.startsWith("VERIFY-")) {
      pushSkip(plan.skippedRows, "04_Trades transactions", row, "placeholder ISIN", `${rawName} -> ${isin}`);
      continue;
    }
    if (!isin) {
      pushSkip(plan.skippedRows, "04_Trades transactions", row, "missing ISIN", rawName || "blank security");
      continue;
    }
    if (!knownIsins.has(isin)) {
      pushSkip(plan.skippedRows, "04_Trades transactions", row, "unmatched securityIsin", `${rawName} -> ${isin}`);
      continue;
    }
    if (rawType !== "BUY" && rawType !== "SELL") {
      pushSkip(plan.skippedRows, "04_Trades transactions", row, "unsupported transaction type", `${rawName} -> ${rawType || "(blank)"}`);
      continue;
    }

    const quantity = parseNumberCell(ws, "G", row, 6);
    const price = parseNumberCell(ws, "H", row, 8);
    const fxRate = parseNumberCell(ws, "J", row, 8);
    const eurAmount = parseNumberCell(ws, "K", row, 4);
    if (!quantity || !price || !fxRate || !eurAmount) {
      pushSkip(plan.skippedRows, "04_Trades transactions", row, "missing numeric value", `${rawName} -> quantity/price/fxRate/eurAmount`);
      continue;
    }

    const sheetNote = stringCell(ws, "L", row);
    plan.transactions.push({
      externalRef: `EXCEL-04Trades-${row}`,
      sourceSheet: "04_Trades",
      row,
      tradeDate,
      type: rawType,
      securityIsin: isin,
      quantity,
      price,
      fxRate,
      eurAmount,
      commission: "0.0000",
      sourceFile: SOURCE_FILE,
      notes: sheetNote || null,
    });
  }
}

function addIncomeTransactions(plan: Plan, wb: XLSX.WorkBook, knownIsins: Set<string>): void {
  const ws = wb.Sheets["05_Dividendi_Interessi"];
  if (!ws) throw new Error("Missing required sheet 05_Dividendi_Interessi");
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:I1");

  for (let row = 5; row <= range.e.r + 1; row++) {
    if (!rowHasAny(ws, row, ["B", "C", "D", "E", "H", "I"])) continue;

    const tradeDate = parseDateCell(ws, "B", row);
    const rawName = stringCell(ws, "D", row);
    const isin = stringCell(ws, "E", row);
    const rawType = stringCell(ws, "C", row).toUpperCase();

    if (!tradeDate) {
      pushSkip(plan.skippedRows, "05_Dividendi_Interessi transactions", row, "missing/invalid tradeDate", rawName || isin || "blank security");
      continue;
    }
    if (tradeDate > CUTOFF) {
      pushSkip(plan.skippedRows, "05_Dividendi_Interessi transactions", row, "date > 2026-04-30", `${tradeDate} ${rawName || isin}`);
      continue;
    }
    if (isin.startsWith("VERIFY-")) {
      pushSkip(plan.skippedRows, "05_Dividendi_Interessi transactions", row, "placeholder ISIN", `${rawName} -> ${isin}`);
      continue;
    }
    if (!isin) {
      pushSkip(plan.skippedRows, "05_Dividendi_Interessi transactions", row, "missing ISIN", rawName || "blank security");
      continue;
    }
    if (!knownIsins.has(isin)) {
      pushSkip(
        plan.skippedRows,
        "05_Dividendi_Interessi transactions",
        row,
        "orphan income (no matching security in 04_Trades)",
        `${rawName} -> ${isin}`
      );
      continue;
    }
    if (!VALID_TRANSACTION_TYPES.has(rawType as TransactionType)) {
      pushSkip(plan.skippedRows, "05_Dividendi_Interessi transactions", row, "unsupported transaction type", `${rawName} -> ${rawType || "(blank)"}`);
      continue;
    }

    const fxRate = parseNumberCell(ws, "H", row, 8);
    const eurAmount = parseNumberCell(ws, "I", row, 4);
    if (!fxRate || !eurAmount) {
      pushSkip(plan.skippedRows, "05_Dividendi_Interessi transactions", row, "missing numeric value", `${rawName} -> fxRate/eurAmount`);
      continue;
    }

    plan.transactions.push({
      externalRef: `EXCEL-05Div-${row}`,
      sourceSheet: "05_Dividendi_Interessi",
      row,
      tradeDate,
      type: rawType as TransactionType,
      securityIsin: isin,
      quantity: "0.000000",
      price: "0.00000000",
      fxRate,
      eurAmount,
      commission: "0.0000",
      sourceFile: SOURCE_FILE,
      notes: rawName ? `Income source: ${rawName}` : null,
    });
  }
}

function buildPlan(workbookPath: string): Plan {
  const wb = XLSX.readFile(workbookPath, { cellDates: false });
  const plan: Plan = {
    workbookPath,
    securities: [],
    aliases: [],
    transactions: [],
    skippedRows: [],
    aliasCollisions: [],
    nameVariants: [],
  };
  const knownIsins = buildSecurityPlan(plan, wb);
  addTradeTransactions(plan, wb, knownIsins);
  addIncomeTransactions(plan, wb, knownIsins);
  return plan;
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce(
    (acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>
  );
}

function transactionsBySheetAndType(transactions: TransactionPlan[]): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const tx of transactions) {
    result[tx.sourceSheet] ??= {};
    result[tx.sourceSheet][tx.type] = (result[tx.sourceSheet][tx.type] ?? 0) + 1;
  }
  return result;
}

function printReport(plan: Plan, apply: boolean): void {
  console.log(`Transaction ledger seed ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Workbook: ${plan.workbookPath}`);
  console.log(`Security source: 04_Trades!D5:E254 only`);
  console.log(`Transaction cutoff: tradeDate <= ${CUTOFF}`);
  console.log("");

  console.log(`Security rows it would upsert: ${plan.securities.length}`);
  console.log(`Security asset classes: ${JSON.stringify(countBy(plan.securities.map((security) => security.assetClass)))}`);
  console.log(`Security price conventions: ${JSON.stringify(countBy(plan.securities.map((security) => security.priceConvention)))}`);
  if (plan.nameVariants.length > 0) {
    console.log("Security name variants from Excel:");
    for (const variant of plan.nameVariants) {
      console.log(`  - ${variant.isin}: ${variant.aliases.join(" | ")}; Security.name=${variant.securityName}`);
    }
  }
  console.log("");

  console.log(`SecurityAlias rows it would insert: ${plan.aliases.length}`);
  if (plan.aliasCollisions.length === 0) {
    console.log("SecurityAlias rawName collisions: none");
  } else {
    console.log("SecurityAlias rawName collisions:");
    for (const collision of plan.aliasCollisions) {
      console.log(`  - ${collision.rawName}: ${collision.isins.join(", ")}`);
    }
  }
  console.log("");

  console.log(`Transaction rows it would insert: ${plan.transactions.length}`);
  const bySheet = transactionsBySheetAndType(plan.transactions);
  for (const [sheet, counts] of Object.entries(bySheet)) {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(`  - ${sheet}: ${total} ${JSON.stringify(counts)}`);
  }
  console.log("");

  if (plan.skippedRows.length === 0) {
    console.log("Skipped rows: none");
  } else {
    console.log(`Skipped rows: ${plan.skippedRows.length}`);
    for (const skipped of plan.skippedRows) {
      console.log(`  - ${skipped.sheet}!${skipped.row}: ${skipped.reason} (${skipped.detail})`);
    }
  }
  console.log("");

  console.log("Known inherited starting-state breaks left untouched:");
  console.log("  - IE00B7J7TB45 base short 12 sh");
  console.log("  - IE00BYZK4883 base short 113 sh");
  console.log("  - LU1681039480 base short 2 sh");
  console.log("  - NL0009690239 base short 24 sh");
  console.log("  - Placeholder row 04_Trades!153 VERIFY-IHYG-5.82 skipped for admin resolution");
  if (!apply) {
    console.log("");
    console.log("No DB writes performed. Re-run with --apply only after admin approval.");
  }
}

function assertSafeToApply(plan: Plan): void {
  if (plan.aliasCollisions.length > 0) {
    throw new Error("Refusing to apply while SecurityAlias rawName collisions exist.");
  }
  const blocking = plan.skippedRows.filter((row) => BLOCKING_SKIP_REASONS.has(row.reason));
  if (blocking.length > 0) {
    throw new Error(`Refusing to apply while ${blocking.length} blocking skipped row(s) exist.`);
  }
}

async function applyPlan(plan: Plan): Promise<void> {
  assertSafeToApply(plan);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for --apply");

  const { getPrisma } = await import("../src/db/prisma");
  const prisma = getPrisma() as any;

  await prisma.$transaction(async (tx: any) => {
    for (const security of plan.securities) {
      await tx.security.upsert({
        where: { isin: security.isin },
        create: {
          isin: security.isin,
          name: security.name,
          currency: security.currency,
          assetClass: security.assetClass,
          priceConvention: security.priceConvention,
        },
        update: {
          name: security.name,
          currency: security.currency,
          assetClass: security.assetClass,
          priceConvention: security.priceConvention,
        },
      });
    }

    await tx.securityAlias.createMany({
      data: plan.aliases.map((alias) => ({
        rawName: alias.rawName,
        isin: alias.isin,
      })),
      skipDuplicates: true,
    });

    await tx.transaction.createMany({
      data: plan.transactions.map((transaction) => ({
        externalRef: transaction.externalRef,
        tradeDate: new Date(`${transaction.tradeDate}T00:00:00.000Z`),
        type: transaction.type,
        securityIsin: transaction.securityIsin,
        quantity: transaction.quantity,
        price: transaction.price,
        fxRate: transaction.fxRate,
        eurAmount: transaction.eurAmount,
        commission: transaction.commission,
        sourceFile: transaction.sourceFile,
        notes: transaction.notes,
      })),
      skipDuplicates: true,
    });
  }, { timeout: 60000 });
}

async function main(): Promise<void> {
  const { apply, workbookPath } = parseArgs();
  const plan = buildPlan(workbookPath);
  printReport(plan, apply);
  if (apply) {
    await applyPlan(plan);
    console.log("");
    console.log("Apply complete.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
