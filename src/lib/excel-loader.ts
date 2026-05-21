import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

export interface InvestorPerfRow {
  name: string;
  type: string;
  subscriptionDate: Date;
  capitalEur: number;
  units: number;
  yearsElapsed: number;
  navUnitAtSub: number;
  currentValueEur: number;
  moic: number;
  irrAnnualized: number;
}

export interface WorkbookData {
  tradeLog: TradeRow[];
  holdings: HoldingRow[];
  portfolioMetrics: Record<string, number | string>;
  irrInvestor: CashFlowRow[];
  irrPortfolio: CashFlowRow[];
  monthlyReturns: MonthlyReturnRow[];
  cutoffDate: Date;
  investorPerformance: InvestorPerfRow[];
  manualItems?: WorkbookManualItem[];
}

export interface WorkbookManualItem {
  itemKey: string;
  displayName: string;
  itemType: "Non-Listed" | "Cash";
  subcategory: string;
  value: number;
  notes: string;
  sortOrder: number;
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
  cumulativeReturn?: number;
}

export const INCOME_TYPES = new Set([
  "DIVIDEND", "INTEREST", "ETF_INCOME", "COUPON", "LOAN_INT", "OTHER",
  "Dividend", "Coupon", "Distribution", "Sec. Lending", "Income",
]);
export const INVESTOR_FLOW_TYPES = new Set(["Deposit", "Withdrawal"]);

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
    const n = parseFloat(val.replace(/[€\s%]/g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function cellVal(ws: XLSX.WorkSheet, r: number, c: number): unknown {
  return ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null;
}

function findSheet(wb: XLSX.WorkBook, fragment: string): XLSX.WorkSheet | null {
  const name = wb.SheetNames.find((n) => n.toLowerCase().includes(fragment.toLowerCase()));
  return name ? wb.Sheets[name] : null;
}

function inferAssetClass(name: string): string {
  const n = name.toUpperCase();
  if (n.includes("ETP") || n.includes("BITCOIN") || n.includes("CRYPTO")) return "Crypto ETPs";
  if (
    n.includes("ETF") ||
    n.includes("UCITS") ||
    n.includes("ISHARES") ||
    n.includes("WISDOMTREE") ||
    n.includes("AMUNDI") ||
    n.includes("XTRACKERS") ||
    n.includes("INVESCO")
  ) return "ETFs / ETCs";
  if (
    n.includes(" %") ||
    n.includes("FINANCE") ||
    n.includes("CEDOLA") ||
    n.includes("COUPON") ||
    n.includes("ZERO COUPON") ||
    n.includes("BOT ") ||
    n.includes("BTP ") ||
    n.includes("CCT ") ||
    n.includes("BUND") ||
    n.match(/\d+\.\d+%/)
  ) return "Bonds";
  return "Stocks";
}

function slugKey(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "ITEM";
}

function numericCell(ws: XLSX.WorkSheet, r: number, c: number): number | null {
  const value = cellVal(ws, r, c);
  if (value === null || value === undefined || value === "") return null;
  const parsed = toNum(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedWorkbookAmount(type: string, amount: number): number {
  const normalized = type.toUpperCase();
  if (
    normalized.includes("SELL") ||
    normalized.includes("REPAY") ||
    normalized.includes("RIMBORS") ||
    normalized.includes("REDEMPTION")
  ) {
    return -Math.abs(amount);
  }
  return Math.abs(amount);
}

function parseWorkbook(wb: XLSX.WorkBook): WorkbookData {

  // ── 01_Assumptions ────────────────────────────────────────────────────────
  const assumSheet = findSheet(wb, "01_Assumptions") ?? findSheet(wb, "Assumptions");
  let cutoffDate = new Date();
  let riskFreeFromSheet = 0.03;
  if (assumSheet) {
    const todayVal = toDate(cellVal(assumSheet, 5, 1)); // B6
    if (todayVal) cutoffDate = todayVal;
    const rf = toNum(cellVal(assumSheet, 6, 1)); // B7
    if (rf > 0) riskFreeFromSheet = rf;
  }

  // ── 11_Performance — pre-computed KPIs ───────────────────────────────────
  const perfSheet = findSheet(wb, "11_Performance") ?? findSheet(wb, "Performance");
  const perfMetrics: Record<string, number | string> = {};
  const irrInvestor: CashFlowRow[] = [];

  if (perfSheet) {
    const range = XLSX.utils.decode_range(perfSheet["!ref"] ?? "A1");
    for (let r = range.s.r; r <= range.e.r; r++) {
      const key = perfSheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v?.toString().trim();
      const valCell = perfSheet[XLSX.utils.encode_cell({ r, c: 1 })];
      if (key && valCell?.v !== undefined && valCell?.v !== null) {
        perfMetrics[key] = valCell.v;
      }
      const cfDate = toDate(perfSheet[XLSX.utils.encode_cell({ r, c: 3 })]?.v);
      const cfAmt = toNum(perfSheet[XLSX.utils.encode_cell({ r, c: 4 })]?.v);
      if (cfDate && cfAmt !== 0) {
        irrInvestor.push({ date: cfDate, cashFlow: cfAmt });
      }
    }
  }

  function pm11(fragment: string): number {
    const key = Object.keys(perfMetrics).find((k) => k.includes(fragment));
    return key ? toNum(perfMetrics[key]) : 0;
  }

  const navTotale        = pm11("NAV TOTALE");
  const capitaleRaccolto = pm11("Capitale Raccolto");
  const listedNetTrade   = pm11("Net Trade Cum");
  const divIntCum        = pm11("Div/Int Lordi Cum.");
  const partNetCum       = pm11("Part. Net Cum");
  const loanNetCum       = pm11("Loan Net Cum");
  const operatingPnlCum  = pm11("P/L Operativa Cum.");
  const listedMvEur      = pm11("Listed MV EUR");
  const partMvEur        = pm11("Partecipazioni MV EUR");
  const prestitiEur      = pm11("Prestiti Outstanding");
  const cassaEur         = pm11("Cassa EUR");
  const navUnit          = pm11("NAV/Unit Corrente");
  const quoteOutst       = pm11("Quote Outstanding");
  const moicValue        = pm11("MOIC (Multiple");
  const returnTotale     = pm11("Return Totale %");
  const irrXirr          = pm11("IRR (XIRR");
  const cagr             = pm11("CAGR Time-Weighted");
  const volatility       = pm11("Volatilit");
  const sharpe           = pm11("Sharpe Ratio");
  const sortino          = pm11("Sortino Ratio");
  const maxDrawdown      = pm11("Max Drawdown");
  const mesiPositivi     = pm11("# Mesi Positivi");
  const mesiTotali       = pm11("# Mesi Totali");
  const winRate          = pm11("Win Rate");

  const portfolioMetrics: Record<string, number | string> = {
    "Total Portfolio Value":    navTotale,
    "NAV":                      navTotale,
    "Capital Committed":        capitaleRaccolto,
    "Listed Net Trade Cost":    listedNetTrade,
    "Total Income":             divIntCum,
    "Total Distributions":      divIntCum,
    "Participation Net Cost":   partNetCum,
    "Loan Net Principal":       loanNetCum,
    "Operating P&L":            operatingPnlCum,
    "Listed Market Value":      listedMvEur,
    "Non-Listed Total":         partMvEur + prestitiEur,
    "Non-Listed Value":         partMvEur + prestitiEur,
    "Loans Outstanding":        prestitiEur,
    "Total Cash":               cassaEur,
    "Cash":                     cassaEur,
    "Investor IRR":             irrXirr,
    "Fund IRR":                 irrXirr,
    "Annualized Return (TWR)":  cagr,
    "MOIC Precomputed":         moicValue,
    "Return Total":             returnTotale,
    "Sharpe Ratio Precomputed": sharpe,
    "Sortino Ratio":            sortino,
    "Volatility Annualized":    volatility,
    "Max Drawdown Precomputed": maxDrawdown,
    "Months Positive":          mesiPositivi,
    "Months Total":             mesiTotali,
    "Win Rate":                 winRate,
    "NAV Unit":                 navUnit,
    "Units Outstanding":        quoteOutst,
    "Risk Free Rate":           riskFreeFromSheet,
    "Unrealized P&L":           0,
    "Realized P&L":             0,
    "Net Total P&L":            navTotale - capitaleRaccolto,
  };
  const manualItems: WorkbookManualItem[] = [];

  // ── 05_Dividendi_Interessi — income events ────────────────────────────────
  const divSheet = findSheet(wb, "05_Dividendi") ?? findSheet(wb, "Dividendi");
  const tradeLog: TradeRow[] = [];

  if (divSheet) {
    const range = XLSX.utils.decode_range(divSheet["!ref"] ?? "A1");
    for (let r = 4; r <= range.e.r; r++) {
      const idVal = cellVal(divSheet, r, 0);
      if (!idVal && idVal !== 0) continue;
      const d = toDate(cellVal(divSheet, r, 1));
      const tipo = cellVal(divSheet, r, 2)?.toString().trim() ?? "";
      const strumento = cellVal(divSheet, r, 3)?.toString() ?? "";
      const amtEur = toNum(cellVal(divSheet, r, 8));
      if (!d || !tipo || amtEur === 0) continue;
      tradeLog.push({
        date: d,
        security: strumento,
        assetClass: "Income",
        currency: cellVal(divSheet, r, 5)?.toString() ?? "EUR",
        type: tipo,
        shares: 0,
        price: 0,
        netAmount: amtEur,
      });
    }
  }

  // ── 09_Posizioni — listed holdings ───────────────────────────────────────
  const partSheet = findSheet(wb, "06_Partecipazioni") ?? findSheet(wb, "Partecipazioni");
  if (partSheet) {
    const range = XLSX.utils.decode_range(partSheet["!ref"] ?? "A1");
    const hasCurrentValues = Array.from({ length: Math.max(0, range.e.r - 3) }).some((_, idx) =>
      numericCell(partSheet, idx + 4, 9) !== null
    );
    const grouped = new Map<string, { displayName: string; value: number }>();

    for (let r = 4; r <= range.e.r; r++) {
      const investee = cellVal(partSheet, r, 3)?.toString().trim();
      if (!investee) continue;
      const type = cellVal(partSheet, r, 2)?.toString().trim() ?? "";
      const amountEur = numericCell(partSheet, r, 8) ?? 0;
      const currentValue = numericCell(partSheet, r, 9);
      const value = hasCurrentValues
        ? currentValue ?? 0
        : signedWorkbookAmount(type, amountEur);
      if (value === 0) continue;
      const key = slugKey(investee);
      const current = grouped.get(key) ?? { displayName: investee, value: 0 };
      current.value += value;
      grouped.set(key, current);
    }

    let order = 10;
    for (const [key, row] of grouped) {
      if (row.value <= 0) continue;
      manualItems.push({
        itemKey: `TRACKER_PARTICIPATION_${key}`,
        displayName: row.displayName,
        itemType: "Non-Listed",
        subcategory: "Participation",
        value: row.value,
        notes: "Seeded from CEO tracker sheet 06_Partecipazioni",
        sortOrder: order,
      });
      order += 10;
    }
  }

  const loanSheet = findSheet(wb, "07_Prestiti") ?? findSheet(wb, "Prestiti");
  if (loanSheet) {
    const range = XLSX.utils.decode_range(loanSheet["!ref"] ?? "A1");
    const hasOutstandingOverrides = Array.from({ length: Math.max(0, range.e.r - 3) }).some((_, idx) =>
      numericCell(loanSheet, idx + 4, 8) !== null
    );
    const grouped = new Map<string, { displayName: string; value: number }>();

    for (let r = 4; r <= range.e.r; r++) {
      const counterparty = cellVal(loanSheet, r, 3)?.toString().trim();
      if (!counterparty) continue;
      const type = cellVal(loanSheet, r, 2)?.toString().trim() ?? "";
      const amountEur = numericCell(loanSheet, r, 7) ?? 0;
      const override = numericCell(loanSheet, r, 8);
      const value = hasOutstandingOverrides
        ? override ?? 0
        : signedWorkbookAmount(type, amountEur);
      if (value === 0) continue;
      const key = slugKey(counterparty);
      const current = grouped.get(key) ?? { displayName: counterparty, value: 0 };
      current.value += value;
      grouped.set(key, current);
    }

    let order = 100;
    for (const [key, row] of grouped) {
      if (row.value <= 0) continue;
      manualItems.push({
        itemKey: `TRACKER_LOAN_${key}`,
        displayName: row.displayName,
        itemType: "Non-Listed",
        subcategory: "Private Loan",
        value: row.value,
        notes: "Seeded from CEO tracker sheet 07_Prestiti",
        sortOrder: order,
      });
      order += 10;
    }
  }

  const posSheet = findSheet(wb, "09_Posizioni") ?? findSheet(wb, "Posizioni");
  const holdings: HoldingRow[] = [];
  let totalListedMv = listedMvEur || 1;

  if (posSheet) {
    const range = XLSX.utils.decode_range(posSheet["!ref"] ?? "A1");
    const rawPositions: HoldingRow[] = [];
    let sumMv = 0;
    for (let r = 4; r <= range.e.r; r++) {
      const isin = cellVal(posSheet, r, 1)?.toString().trim();
      if (!isin) continue;
      const nome = cellVal(posSheet, r, 2)?.toString().trim() ?? isin;
      const valuta = cellVal(posSheet, r, 3)?.toString().trim() ?? "EUR";
      const qtyNetta = toNum(cellVal(posSheet, r, 6));
      if (qtyNetta <= 0) continue;

      const lastPrice = toNum(cellVal(posSheet, r, 7));
      const fxToEur = toNum(cellVal(posSheet, r, 8)) || 1;
      const mvLastTrade = toNum(cellVal(posSheet, r, 10));
      const costoMedio = toNum(cellVal(posSheet, r, 11));
      const spotPrice = toNum(cellVal(posSheet, r, 13));
      const mvSpot = toNum(cellVal(posSheet, r, 14));
      const mvEur = mvSpot > 0 ? mvSpot : mvLastTrade;
      const currentPriceEur = spotPrice > 0 ? spotPrice * fxToEur : lastPrice * fxToEur;

      const costBasis = qtyNetta * costoMedio;
      const pnlEur = mvEur - costBasis;
      const pnlPct = costBasis > 0 ? pnlEur / costBasis : 0;
      sumMv += mvEur;

      rawPositions.push({
        security: nome,
        assetClass: inferAssetClass(nome),
        currency: valuta,
        shares: qtyNetta,
        avgCost: costoMedio,
        costBasis,
        currentPrice: currentPriceEur,
        marketValue: mvEur,
        unrealizedPnl: pnlEur,
        pnlPct,
        weight: 0,
      });
    }
    if (sumMv > 0) totalListedMv = sumMv;
    for (const h of rawPositions) {
      h.weight = totalListedMv > 0 ? h.marketValue / totalListedMv : 0;
      holdings.push(h);
    }
  }

  // ── 10_NAV_Mensile — monthly NAV series ──────────────────────────────────
  const navSheet = findSheet(wb, "10_NAV_Mensile") ?? findSheet(wb, "NAV_Mensile");
  const monthlyReturns: MonthlyReturnRow[] = [];

  if (navSheet) {
    const range = XLSX.utils.decode_range(navSheet["!ref"] ?? "A1");
    const rawNav: { monthEnd: Date; nav: number; navUnit: number }[] = [];

    for (let r = 4; r <= range.e.r; r++) {
      const d = toDate(cellVal(navSheet, r, 1));
      const nav = toNum(cellVal(navSheet, r, 12));
      const quoteOuts = toNum(cellVal(navSheet, r, 13));
      const navPerUnit = toNum(cellVal(navSheet, r, 14));
      if (!d || nav <= 0 || quoteOuts <= 0) continue;
      rawNav.push({ monthEnd: d, nav, navUnit: navPerUnit });
    }
    rawNav.sort((a, b) => a.monthEnd.getTime() - b.monthEnd.getTime());

    for (let i = 0; i < rawNav.length; i++) {
      const curr = rawNav[i];
      const prev = rawNav[i - 1];
      const monthlyReturn = prev && prev.navUnit > 0 ? curr.navUnit / prev.navUnit - 1 : 0;
      monthlyReturns.push({ monthEnd: curr.monthEnd, nav: curr.nav, monthlyReturn });
    }
  }

  if (monthlyReturns.length > 0) {
    const lastNavDate = monthlyReturns[monthlyReturns.length - 1].monthEnd;
    if (cutoffDate < lastNavDate) cutoffDate = lastNavDate;
  }

  // ── 12_Perf_Investitori — per-investor performance ────────────────────────
  const perfInvSheet = findSheet(wb, "12_Perf_Investitori") ?? findSheet(wb, "Perf_Investitori");
  const investorPerformance: InvestorPerfRow[] = [];

  if (perfInvSheet) {
    const range = XLSX.utils.decode_range(perfInvSheet["!ref"] ?? "A1");
    for (let r = 4; r <= range.e.r; r++) {
      const name = cellVal(perfInvSheet, r, 1)?.toString().trim();
      if (!name || name === "0") continue;
      const d = toDate(cellVal(perfInvSheet, r, 3));
      if (!d) continue;
      investorPerformance.push({
        name,
        type: cellVal(perfInvSheet, r, 2)?.toString() ?? "LP",
        subscriptionDate: d,
        capitalEur: toNum(cellVal(perfInvSheet, r, 4)),
        units: toNum(cellVal(perfInvSheet, r, 5)),
        yearsElapsed: toNum(cellVal(perfInvSheet, r, 6)),
        navUnitAtSub: toNum(cellVal(perfInvSheet, r, 7)),
        currentValueEur: toNum(cellVal(perfInvSheet, r, 8)),
        moic: toNum(cellVal(perfInvSheet, r, 9)),
        irrAnnualized: toNum(cellVal(perfInvSheet, r, 10)),
      });
    }
  }

  // ── Fallback: Audit workbook format (produced by buildAuditWorkbookBuffer) ──────
  // When the original CEO Excel sheets (09_Posizioni, 05_Dividendi, 10_NAV_Mensile)
  // are absent, try the audit-format equivalents so the workbook round-trips cleanly.

  if (holdings.length === 0) {
    const auditHoldings = findSheet(wb, "Holdings");
    if (auditHoldings) {
      const cdVal = toDate(cellVal(auditHoldings, 2, 6));
      if (cdVal) cutoffDate = cdVal;
      const range = XLSX.utils.decode_range(auditHoldings["!ref"] ?? "A1");
      for (let r = 5; r <= range.e.r; r++) {
        const security = cellVal(auditHoldings, r, 0)?.toString().trim();
        if (!security) continue;
        holdings.push({
          security,
          assetClass: cellVal(auditHoldings, r, 1)?.toString() ?? "",
          currency: cellVal(auditHoldings, r, 2)?.toString() ?? "EUR",
          shares: toNum(cellVal(auditHoldings, r, 3)),
          avgCost: toNum(cellVal(auditHoldings, r, 4)),
          costBasis: toNum(cellVal(auditHoldings, r, 5)),
          currentPrice: toNum(cellVal(auditHoldings, r, 6)),
          marketValue: toNum(cellVal(auditHoldings, r, 7)),
          unrealizedPnl: toNum(cellVal(auditHoldings, r, 8)),
          pnlPct: toNum(cellVal(auditHoldings, r, 9)),
          weight: toNum(cellVal(auditHoldings, r, 10)),
        });
      }
    }
  }

  if (tradeLog.length === 0) {
    const auditTrades = findSheet(wb, "Trade Log");
    if (auditTrades) {
      const range = XLSX.utils.decode_range(auditTrades["!ref"] ?? "A1");
      for (let r = 3; r <= range.e.r; r++) {
        const d = toDate(cellVal(auditTrades, r, 0));
        const type = cellVal(auditTrades, r, 5)?.toString().trim() ?? "";
        if (!d || !type) continue;
        tradeLog.push({
          date: d,
          security: cellVal(auditTrades, r, 2)?.toString().trim() ?? "",
          assetClass: cellVal(auditTrades, r, 3)?.toString() ?? "",
          currency: cellVal(auditTrades, r, 4)?.toString() ?? "EUR",
          type,
          shares: toNum(cellVal(auditTrades, r, 6)),
          price: toNum(cellVal(auditTrades, r, 7)),
          netAmount: toNum(cellVal(auditTrades, r, 10)),
        });
      }
    }
  }

  if (monthlyReturns.length === 0) {
    const auditMonthly = findSheet(wb, "Monthly Returns");
    if (auditMonthly) {
      const range = XLSX.utils.decode_range(auditMonthly["!ref"] ?? "A1");
      const rawRows: { monthEnd: Date; nav: number; monthlyReturn: number }[] = [];
      for (let r = 5; r <= range.e.r; r++) {
        const d = toDate(cellVal(auditMonthly, r, 0));
        const nav = toNum(cellVal(auditMonthly, r, 1));
        if (!d || nav <= 0) continue;
        rawRows.push({ monthEnd: d, nav, monthlyReturn: toNum(cellVal(auditMonthly, r, 4)) });
      }
      rawRows.sort((a, b) => a.monthEnd.getTime() - b.monthEnd.getTime());
      for (const row of rawRows) {
        monthlyReturns.push({ monthEnd: row.monthEnd, nav: row.nav, monthlyReturn: row.monthlyReturn });
      }
      if (monthlyReturns.length > 0) {
        const lastDate = monthlyReturns[monthlyReturns.length - 1].monthEnd;
        if (cutoffDate < lastDate) cutoffDate = lastDate;
      }
    }
  }

  return {
    tradeLog,
    holdings,
    portfolioMetrics,
    irrInvestor,
    irrPortfolio: [],
    monthlyReturns,
    cutoffDate,
    investorPerformance,
    manualItems,
  };
}

export function loadWorkbook(filePath: string): WorkbookData {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workbook not found at: ${resolved}`);
  }
  const wb = XLSX.readFile(resolved, { cellDates: false, cellNF: false });
  return parseWorkbook(wb);
}

export function loadWorkbookFromBuffer(buffer: Buffer | ArrayBuffer | Uint8Array): WorkbookData {
  const wb = XLSX.read(buffer, { cellDates: false, cellNF: false });
  return parseWorkbook(wb);
}
