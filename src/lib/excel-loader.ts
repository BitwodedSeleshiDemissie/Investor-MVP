import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

export interface WorkbookData {
  tradeLog: TradeRow[];
  holdings: HoldingRow[];
  portfolioMetrics: Record<string, number | string>;
  irrInvestor: CashFlowRow[];
  irrPortfolio: CashFlowRow[];
  monthlyReturns: MonthlyReturnRow[];
  cutoffDate: Date;
}

export interface TradeRow {
  date: Date;
  security: string;
  assetClass: string;
  currency: string;
  type: string;
  shares: number;
  price: number;
  netAmount: number;
}

export interface HoldingRow {
  security: string;
  assetClass: string;
  currency: string;
  shares: number;
  avgCost: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  pnlPct: number;
  weight: number;
}

export interface CashFlowRow {
  date: Date;
  cashFlow: number;
}

export interface MonthlyReturnRow {
  monthEnd: Date;
  nav: number;
  monthlyReturn: number;
}

export const INCOME_TYPES = new Set(["Dividend", "Coupon", "Distribution", "Sec. Lending", "Income"]);
export const INVESTOR_FLOW_TYPES = new Set(["Deposit", "Withdrawal"]);
const NON_TRADE_TYPES = new Set(["Balance", "Tax"]);

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function toNum(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val.replace(/[€\s]/g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// Read headers + data rows keyed by column name — matches pandas header=N (0-based)
function sheetToRows(ws: XLSX.WorkSheet, headerRowIdx: number): Record<string, unknown>[] {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRowIdx, c })];
    headers.push(cell?.v?.toString().trim() ?? `col_${c}`);
  }
  const rows: Record<string, unknown>[] = [];
  for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
    const row: Record<string, unknown> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row[headers[c - range.s.c]] = cell?.v ?? null;
    }
    rows.push(row);
  }
  return rows;
}

// Read data rows by column position — matches pandas with explicit df.columns rename
function sheetToPositionalRows(ws: XLSX.WorkSheet, headerRowIdx: number): unknown[][] {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const rows: unknown[][] = [];
  for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
    const cols: unknown[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      cols.push(cell?.v ?? null);
    }
    rows.push(cols);
  }
  return rows;
}

function findSheetName(wb: XLSX.WorkBook, pattern: string): string | undefined {
  return wb.SheetNames.find((n) => n.toLowerCase().includes(pattern.toLowerCase()));
}

export function loadWorkbook(filePath: string): WorkbookData {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workbook not found at: ${resolved}`);
  }
  const wb = XLSX.readFile(resolved, { cellDates: false, cellNF: false });

  // ── Portfolio Metrics ──────────────────────────────────────────────────────
  // Matches Python: reads col 0→1 (left block) AND col 3→4 (right block)
  const pmSheet = wb.Sheets[findSheetName(wb, "Portfolio Metrics") ?? wb.SheetNames[0]];
  const portfolioMetrics: Record<string, number | string> = {};
  if (pmSheet) {
    const range = XLSX.utils.decode_range(pmSheet["!ref"] ?? "A1");
    for (let r = range.s.r; r <= range.e.r; r++) {
      // Left block: col A (0) → col B (1)
      const keyA = pmSheet[XLSX.utils.encode_cell({ r, c: 0 })];
      const valA = pmSheet[XLSX.utils.encode_cell({ r, c: 1 })];
      if (keyA?.v && valA?.v !== undefined && valA?.v !== null) {
        portfolioMetrics[keyA.v.toString().trim()] = valA.v;
      }
      // Right block: col D (3) → col E (4)
      const keyD = pmSheet[XLSX.utils.encode_cell({ r, c: 3 })];
      const valE = pmSheet[XLSX.utils.encode_cell({ r, c: 4 })];
      if (keyD?.v && valE?.v !== undefined && valE?.v !== null) {
        portfolioMetrics[keyD.v.toString().trim()] = valE.v;
      }
    }
  }

  // ── Holdings ───────────────────────────────────────────────────────────────
  // Python: header=4 (0-based) = Excel row 5; cutoff at iloc[2,6] = G3
  // Uses positional columns: Security=0, AssetClass=1, Currency=2, Shares=3,
  // AvgCost=4, CostBasis=5, Price=6, MarketValue=7, UnrealPnl=8, PnlPct=9, Weight=10
  const holdingsSheet = wb.Sheets[findSheetName(wb, "Holdings") ?? ""];
  const holdings: HoldingRow[] = [];
  let cutoffDate = new Date();
  if (holdingsSheet) {
    // Cutoff date at G3 (row index 2, col index 6)
    const cutoffCell = holdingsSheet[XLSX.utils.encode_cell({ r: 2, c: 6 })]
      ?? holdingsSheet["G3"]
      ?? holdingsSheet["H3"];
    const cd = toDate(cutoffCell?.v);
    if (cd) cutoffDate = cd;

    const rows = sheetToPositionalRows(holdingsSheet, 4); // header at row index 4 = Excel row 5
    for (const row of rows) {
      const security = row[0]?.toString().trim() ?? "";
      if (!security || security.toUpperCase() === "TOTAL" || security === "Security") continue;
      // pnlPct and weight are already decimals (0.0525 = 5.25%) — do NOT divide by 100
      holdings.push({
        security,
        assetClass: row[1]?.toString().trim() ?? "Unknown",
        currency: row[2]?.toString().trim() ?? "EUR",
        shares: toNum(row[3]),
        avgCost: toNum(row[4]),
        costBasis: toNum(row[5]),
        currentPrice: toNum(row[6]),
        marketValue: toNum(row[7]),
        unrealizedPnl: toNum(row[8]),
        pnlPct: toNum(row[9]),   // already a decimal fraction
        weight: toNum(row[10]),  // already a decimal fraction
      });
    }
  }

  // ── Trade Log ──────────────────────────────────────────────────────────────
  // Python: header=2 (0-based) = Excel row 3
  // Columns: Date, Settlement, Security, Asset Class, Currency, Type, Quantity, Price, Amount (EUR), Commission, Net Amount
  const tlSheet = wb.Sheets[findSheetName(wb, "Trade Log") ?? findSheetName(wb, "Trades") ?? ""];
  const tradeLog: TradeRow[] = [];
  if (tlSheet) {
    const rows = sheetToRows(tlSheet, 2); // header at row index 2 = Excel row 3
    for (const row of rows) {
      const type = row["Type"]?.toString() ?? row["Transaction Type"]?.toString() ?? "";
      if (!type || NON_TRADE_TYPES.has(type) || type === "Type") continue;
      const d = toDate(row["Date"] ?? row["Trade Date"]);
      if (!d) continue;
      tradeLog.push({
        date: d,
        security: row["Security"]?.toString() ?? row["Name"]?.toString() ?? "",
        assetClass: row["Asset Class"]?.toString() ?? "",
        currency: row["Currency"]?.toString() ?? "EUR",
        type,
        shares: toNum(row["Quantity"] ?? row["Shares"] ?? row["Qty"]),
        price: toNum(row["Price"]),
        netAmount: toNum(row["Net Amount"] ?? row["Amount"]),
      });
    }
  }

  // ── IRR Analysis ───────────────────────────────────────────────────────────
  // Python: raw.iloc[9:, [0,1]] for investor; raw.iloc[9:, [4,5]] for portfolio
  // Row index 9 (0-based) = data starts at Excel row 10
  const irrSheet = wb.Sheets[findSheetName(wb, "IRR") ?? ""];
  const irrInvestor: CashFlowRow[] = [];
  const irrPortfolio: CashFlowRow[] = [];
  if (irrSheet) {
    const range = XLSX.utils.decode_range(irrSheet["!ref"] ?? "A1");
    for (let r = 9; r <= range.e.r; r++) {
      const d1 = toDate(irrSheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v);
      const v1 = irrSheet[XLSX.utils.encode_cell({ r, c: 1 })]?.v;
      if (d1 && v1 !== undefined && v1 !== null) {
        irrInvestor.push({ date: d1, cashFlow: toNum(v1) });
      }
      const d2 = toDate(irrSheet[XLSX.utils.encode_cell({ r, c: 4 })]?.v);
      const v2 = irrSheet[XLSX.utils.encode_cell({ r, c: 5 })]?.v;
      if (d2 && v2 !== undefined && v2 !== null) {
        irrPortfolio.push({ date: d2, cashFlow: toNum(v2) });
      }
    }
  }

  // ── Monthly Returns ────────────────────────────────────────────────────────
  // Python: header=4 (0-based) = Excel row 5; df.columns renamed to:
  // ["Month End", "Portfolio Value", "Deposits In Month", "Withdrawals In Month", "Monthly Return", "Cumulative Return"]
  // Uses positional: col 0 = date, col 1 = NAV, col 4 = monthly return
  const mrSheet = wb.Sheets[findSheetName(wb, "Monthly Returns") ?? findSheetName(wb, "NAV") ?? ""];
  const monthlyReturns: MonthlyReturnRow[] = [];
  if (mrSheet) {
    const rows = sheetToPositionalRows(mrSheet, 4); // header at row index 4 = Excel row 5
    for (const row of rows) {
      const d = toDate(row[0]);
      const nav = toNum(row[1]);
      if (!d || nav <= 0) continue;
      monthlyReturns.push({
        monthEnd: d,
        nav,
        monthlyReturn: toNum(row[4]),
      });
    }
    monthlyReturns.sort((a, b) => a.monthEnd.getTime() - b.monthEnd.getTime());
  }

  return { tradeLog, holdings, portfolioMetrics, irrInvestor, irrPortfolio, monthlyReturns, cutoffDate };
}
