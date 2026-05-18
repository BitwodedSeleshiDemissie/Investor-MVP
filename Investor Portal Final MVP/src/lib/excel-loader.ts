/**
 * Excel loader for Ariete Capital Investment Tracker format.
 * Reads the 15-sheet CEO-approved workbook (00_Dashboard … 99_Integrity).
 * All KPIs are taken from pre-computed 11_Performance values so the
 * portal always shows exactly what the CEO's tracker shows.
 */
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

// ── Public interfaces (unchanged — calculations.ts depends on these) ─────────

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
  tradeLog: TradeRow[];          // income events (05_Dividendi_Interessi)
  holdings: HoldingRow[];        // listed positions (09_Posizioni)
  portfolioMetrics: Record<string, number | string>;
  irrInvestor: CashFlowRow[];    // subscription cashflows (11_Performance cols D-E)
  irrPortfolio: CashFlowRow[];   // not used in this tracker
  monthlyReturns: MonthlyReturnRow[];
  cutoffDate: Date;
  investorPerformance: InvestorPerfRow[];
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

// Income types recognised by the CEO tracker (05_Dividendi_Interessi)
export const INCOME_TYPES = new Set([
  "DIVIDEND", "INTEREST", "ETF_INCOME", "COUPON", "LOAN_INT", "OTHER",
  // Legacy aliases kept for backward compat
  "Dividend", "Coupon", "Distribution", "Sec. Lending", "Income",
]);
export const INVESTOR_FLOW_TYPES = new Set(["Deposit", "Withdrawal"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function cell(ws: XLSX.WorkSheet, r: number, c: number): XLSX.CellObject | undefined {
  return ws[XLSX.utils.encode_cell({ r, c })];
}

function cellVal(ws: XLSX.WorkSheet, r: number, c: number): unknown {
  return cell(ws, r, c)?.v ?? null;
}

function findSheet(wb: XLSX.WorkBook, fragment: string): XLSX.WorkSheet | null {
  const name = wb.SheetNames.find((n) => n.toLowerCase().includes(fragment.toLowerCase()));
  return name ? wb.Sheets[name] : null;
}

// ── Asset-class inference (09_Posizioni has no asset-class column) ────────────

function inferAssetClass(name: string): string {
  const n = name.toUpperCase();
  // Order matters: ETP before ETF
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

// ── Main loader ───────────────────────────────────────────────────────────────

export function loadWorkbook(filePath: string): WorkbookData {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workbook not found at: ${resolved}`);
  }
  const wb = XLSX.readFile(resolved, { cellDates: false, cellNF: false });

  // ── 01_Assumptions ────────────────────────────────────────────────────────
  // Row 6 (0-based 5): Valuta Base | EUR
  // Row 7 (0-based 6): Data Odierna | date
  // Row 8 (0-based 7): Tasso Risk-Free | 0.03
  // Row 11 (0-based 10): Hurdle Rate | 0.05
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
  // Key-value pairs in columns A (0) and B (1), starting at row index 4 (Excel row 5).
  // CF helper columns: D (3) = date, E (4) = cashflow amount.
  const perfSheet = findSheet(wb, "11_Performance") ?? findSheet(wb, "Performance");
  const perfMetrics: Record<string, number | string> = {};
  const irrInvestor: CashFlowRow[] = [];

  if (perfSheet) {
    const range = XLSX.utils.decode_range(perfSheet["!ref"] ?? "A1");
    for (let r = range.s.r; r <= range.e.r; r++) {
      // Key-value (A-B)
      const key = perfSheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v?.toString().trim();
      const valCell = perfSheet[XLSX.utils.encode_cell({ r, c: 1 })];
      if (key && valCell?.v !== undefined && valCell?.v !== null) {
        perfMetrics[key] = valCell.v;
      }
      // CF cashflows (D-E)
      const cfDate = toDate(perfSheet[XLSX.utils.encode_cell({ r, c: 3 })]?.v);
      const cfAmt = toNum(perfSheet[XLSX.utils.encode_cell({ r, c: 4 })]?.v);
      if (cfDate && cfAmt !== 0) {
        irrInvestor.push({ date: cfDate, cashFlow: cfAmt });
      }
    }
  }

  // Helper: read a numeric perfMetric by key substring
  function pm11(fragment: string): number {
    const key = Object.keys(perfMetrics).find((k) => k.includes(fragment));
    return key ? toNum(perfMetrics[key]) : 0;
  }

  const navTotale       = pm11("NAV TOTALE");
  const capitaleRaccolto = pm11("Capitale Raccolto");
  const divIntCum       = pm11("Div/Int Lordi Cum.");
  const listedMvEur     = pm11("Listed MV EUR");
  const partMvEur       = pm11("Partecipazioni MV EUR");
  const prestitiEur     = pm11("Prestiti Outstanding");
  const cassaEur        = pm11("Cassa EUR");
  const navUnit         = pm11("NAV/Unit Corrente");
  const quoteOutst      = pm11("Quote Outstanding");
  const moicValue       = pm11("MOIC (Multiple");
  const returnTotale    = pm11("Return Totale %");
  const irrXirr         = pm11("IRR (XIRR");
  const cagr            = pm11("CAGR Time-Weighted");
  const volatility      = pm11("Volatilit"); // accented "à" — match by prefix
  const sharpe          = pm11("Sharpe Ratio");
  const sortino         = pm11("Sortino Ratio");
  const maxDrawdown     = pm11("Max Drawdown");
  const mesiPositivi    = pm11("# Mesi Positivi");
  const mesiTotali      = pm11("# Mesi Totali");
  const winRate         = pm11("Win Rate");

  // Map to English keys that calculations.ts already looks for
  const portfolioMetrics: Record<string, number | string> = {
    "Total Portfolio Value":     navTotale,
    "NAV":                       navTotale,
    "Capital Committed":         capitaleRaccolto,
    "Total Income":              divIntCum,
    "Total Distributions":       divIntCum,
    "Listed Market Value":       listedMvEur,
    "Non-Listed Total":          partMvEur + prestitiEur,
    "Non-Listed Value":          partMvEur + prestitiEur,
    "Loans Outstanding":         prestitiEur,
    "Total Cash":                cassaEur,
    "Cash":                      cassaEur,
    "Investor IRR":              irrXirr,
    "Fund IRR":                  irrXirr,
    "Annualized Return (TWR)":   cagr,
    "MOIC Precomputed":          moicValue,
    "Return Total":              returnTotale,
    "Sharpe Ratio Precomputed":  sharpe,
    "Sortino Ratio":             sortino,
    "Volatility Annualized":     volatility,
    "Max Drawdown Precomputed":  maxDrawdown,
    "Months Positive":           mesiPositivi,
    "Months Total":              mesiTotali,
    "Win Rate":                  winRate,
    "NAV Unit":                  navUnit,
    "Units Outstanding":         quoteOutst,
    "Risk Free Rate":            riskFreeFromSheet,
    // P&L fields
    "Unrealized P&L":            0,
    "Realized P&L":              0,
    "Net Total P&L":             navTotale - capitaleRaccolto,
  };

  // ── 05_Dividendi_Interessi — income events ────────────────────────────────
  // Header at row index 3 (Excel row 4). Data from row index 4 onwards.
  // Cols: 0=ID, 1=Data, 2=Tipo, 3=Strumento, 4=ISIN, 5=Valuta, 6=Lordo Loc., 7=FX, 8=Lordo EUR
  const divSheet = findSheet(wb, "05_Dividendi") ?? findSheet(wb, "Dividendi");
  const tradeLog: TradeRow[] = [];

  if (divSheet) {
    const range = XLSX.utils.decode_range(divSheet["!ref"] ?? "A1");
    for (let r = 4; r <= range.e.r; r++) {
      const idVal = cellVal(divSheet, r, 0);
      if (!idVal && idVal !== 0) continue; // skip empty rows
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
  // Header at row index 3 (Excel row 4). Data from row index 4 onwards.
  // Cols: 0=#, 1=ISIN, 2=Nome, 3=Valuta, 4=Qty BUY, 5=Qty SELL, 6=Qty Netta,
  //       7=Ultimo Prezzo Loc., 8=Ultimo FX, 9=MV Loc., 10=MV EUR,
  //       11=Costo Medio EUR, 12=P&L Non Realiz. EUR, 13=Prezzo Spot, 14=MV Spot EUR
  const posSheet = findSheet(wb, "09_Posizioni") ?? findSheet(wb, "Posizioni");
  const holdings: HoldingRow[] = [];
  let totalListedMv = listedMvEur || 1;

  if (posSheet) {
    const range = XLSX.utils.decode_range(posSheet["!ref"] ?? "A1");
    // First pass: collect all valid positions to compute total MV
    const rawPositions: HoldingRow[] = [];
    let sumMv = 0;
    for (let r = 4; r <= range.e.r; r++) {
      const isin = cellVal(posSheet, r, 1)?.toString().trim();
      if (!isin) continue;
      const nome = cellVal(posSheet, r, 2)?.toString().trim() ?? isin;
      const valuta = cellVal(posSheet, r, 3)?.toString().trim() ?? "EUR";
      const qtyNetta = toNum(cellVal(posSheet, r, 6));
      if (qtyNetta <= 0) continue; // skip closed positions

      const lastPrice = toNum(cellVal(posSheet, r, 7));
      const fxToEur = toNum(cellVal(posSheet, r, 8)) || 1;
      const mvLastTrade = toNum(cellVal(posSheet, r, 10));
      const costoMedio = toNum(cellVal(posSheet, r, 11)); // per unit, in EUR
      const pnlLastTrade = toNum(cellVal(posSheet, r, 12));

      // Prefer Prezzo Spot (col 13) / MV Spot EUR (col 14) when available
      // as that's what 11_Performance "Listed MV EUR" is based on
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
        weight: 0, // computed below
      });
    }
    if (sumMv > 0) totalListedMv = sumMv;
    for (const h of rawPositions) {
      h.weight = totalListedMv > 0 ? h.marketValue / totalListedMv : 0;
      holdings.push(h);
    }
  }

  // ── 10_NAV_Mensile — monthly NAV series ──────────────────────────────────
  // Header at row index 3 (Excel row 4). Data from row index 4 onwards.
  // Cols: 0=#, 1=Data Fine Mese, 2=Capitale Cum., 3=Net Trade Cum.,
  //       4=Div/Int Cum., 5=Part. Net, 6=Loan Net, 7=P/L Op., 8=Cassa,
  //       9=Listed MV override, 10=Part. MV override, 11=Loan override,
  //       12=NAV, 13=Quote Outst., 14=NAV/Unit
  const navSheet = findSheet(wb, "10_NAV_Mensile") ?? findSheet(wb, "NAV_Mensile");
  const monthlyReturns: MonthlyReturnRow[] = [];

  if (navSheet) {
    const range = XLSX.utils.decode_range(navSheet["!ref"] ?? "A1");
    const rawNav: { monthEnd: Date; nav: number; navUnit: number }[] = [];

    for (let r = 4; r <= range.e.r; r++) {
      const d = toDate(cellVal(navSheet, r, 1));
      const nav = toNum(cellVal(navSheet, r, 12));
      const quoteOutst = toNum(cellVal(navSheet, r, 13));
      const navPerUnit = toNum(cellVal(navSheet, r, 14));
      if (!d || nav <= 0 || quoteOutst <= 0) continue; // skip pre-investor months
      rawNav.push({ monthEnd: d, nav, navUnit: navPerUnit });
    }
    rawNav.sort((a, b) => a.monthEnd.getTime() - b.monthEnd.getTime());

    for (let i = 0; i < rawNav.length; i++) {
      const curr = rawNav[i];
      const prev = rawNav[i - 1];
      const monthlyReturn =
        prev && prev.navUnit > 0 ? curr.navUnit / prev.navUnit - 1 : 0;
      monthlyReturns.push({
        monthEnd: curr.monthEnd,
        nav: curr.nav,
        monthlyReturn,
      });
    }
  }

  // Update cutoff to latest NAV month if later than assumptions date
  if (monthlyReturns.length > 0) {
    const lastNavDate = monthlyReturns[monthlyReturns.length - 1].monthEnd;
    if (cutoffDate < lastNavDate) cutoffDate = lastNavDate;
  }

  // ── 12_Perf_Investitori — per-investor performance ────────────────────────
  // Header at row index 3 (Excel row 4). Data from row index 4 onwards.
  // Cols: 0=#, 1=Investitore, 2=Tipo, 3=Data Sottoscr., 4=Capitale EUR,
  //       5=Quote, 6=Anni Trascorsi, 7=NAV/Unit@Sub, 8=Current Value EUR,
  //       9=MOIC, 10=IRR Annualizz.
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

  return {
    tradeLog,
    holdings,
    portfolioMetrics,
    irrInvestor,
    irrPortfolio: [],
    monthlyReturns,
    cutoffDate,
    investorPerformance,
  };
}
