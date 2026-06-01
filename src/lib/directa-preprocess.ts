// Ports preprocess.py: statement CSV exports -> WorkbookData (in-memory, no Excel round-trip).
// The resulting WorkbookData is fed directly into the existing calculations.ts functions.

import type { WorkbookData, HoldingRow, CashFlowRow, MonthlyReturnRow } from "./excel-loader";
import type { Holding, NavPoint } from "@/types/portfolio";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { resolveIsin } from "./isin";

// ── Tipo ──────────────────────────────────────────────────────────────────────

type Tipo = "Stock" | "ETF/ETC" | "Crypto ETP" | "Bond" | "Cash" | "Other";

// Seed from the 57 historically seen securities in .tipo_cache.json.
// New securities fall through to rule-based → DB cache → Claude fallback.
const SEED_CACHE: Record<string, Tipo> = {
  "ISHARES EURO STOXX SMALL UCITS": "ETF/ETC",
  "VANECK GLOBAL REAL ESTATE  UCI": "ETF/ETC",
  "D AMICO": "Stock",
  "ENEL": "Stock",
  "ISHARES STX EUROPE SEL DIV 30": "ETF/ETC",
  "ASML HOLDING NV": "Stock",
  "ORACLE CORP": "Stock",
  "ISHARES MSCI JA SMALL CAP UCIT": "ETF/ETC",
  "TAMBURI": "Stock",
  "INTESA SANPAOLO": "Stock",
  "TRIGANO SA": "Stock",
  "BOT ZC DEC25 A EUR": "Bond",
  "NEXI": "Stock",
  "BREMBO": "Stock",
  "iShares Glob Aerospc & Defence": "ETF/ETC",
  "WISDOMTREE CORE PHYSICAL GOLD": "ETF/ETC",
  "PIAGGIO": "Stock",
  "RAI WAY": "Stock",
  "Saldo Iniziale": "Cash",
  "ISHARES DIGITALISATION UCITS E": "ETF/ETC",
  "Bitwise Physical Ethereum ETP": "Crypto ETP",
  "ISHARES FTSE MIB UCITS ETF EUR": "ETF/ETC",
  "MONCLER": "Stock",
  "ENI S.P.A.": "Stock",
  "AMUNDI FTSE EPRA EUR REAL EST": "ETF/ETC",
  "BOT ZC APR26 A EUR": "Bond",
  "BOT ZC MAR26 A EUR": "Bond",
  "MEDIOBANCA": "Stock",
  "CARRARO FINANCE FX 5.25% APR30": "Bond",
  "BOT ZC NOV25 S EUR": "Bond",
  "WISDOMTREE PHYSICAL SILVER": "ETF/ETC",
  "BRUNELLO CUCINELLI": "Stock",
  "BTP FX 3.2% JAN26 EUR": "Bond",
  "Bitwise Ethereum Staking ETP": "Crypto ETP",
  "AZIMUT": "Stock",
  "WisdomTree Europe Defence UCIT": "ETF/ETC",
  "ISHARES GLOBAL CORP BOND UCITS": "ETF/ETC",
  "Bitwise Physical Bitcoin ETP": "Crypto ETP",
  "FERRARI": "Stock",
  "ISHARES HIGH YLD CORP UCITS ET": "ETF/ETC",
  "SANLORENZO": "Stock",
  "BOT ZC JAN26 A EUR": "Bond",
  "ISHARES DIGITAL SECURITY UCITS": "ETF/ETC",
  "DE LONGY": "Stock",
  "BOT ZC OCT25 A EUR": "Bond",
  "ITALGAS": "Stock",
  "BeC SPEAKERS": "Stock",
  "INTERPUMP GROUP": "Stock",
  "ISHARES GLO HIGH YLD CORP UCIT": "ETF/ETC",
  "BITWISE solana staking ETP": "Crypto ETP",
  "IGD": "Stock",
  "EXOR NV": "Stock",
  "WISDOMTREE NEW ECON REAL EST U": "ETF/ETC",
  "BTP FX 3.1% AUG26 EUR": "Bond",
  "CY4GATE": "Stock",
  "iShares   High Yield Corp Bond": "ETF/ETC",
  "DE LONGHI": "Stock",
};

// Rules match the Python SYSTEM_PROMPT applied in order.
function classifyByRules(name: string): Tipo | null {
  const s = name.trim();
  if (!s) return null;
  if (s === "Saldo Iniziale") return "Cash";

  const upper = s.toUpperCase();
  const lc = s.toLowerCase();

  // Rule 1: Government bonds (highest priority, explicit prefix)
  if (
    upper.startsWith("BOT ") ||
    upper.startsWith("BTP ") ||
    upper.startsWith("CCT ") ||
    lc.includes("ratei")
  ) {
    return "Bond";
  }

  // Rule 2: ETF/ETC keywords
  if (
    lc.includes("wisdomtree") ||
    lc.includes("ishares") ||
    lc.includes("amundi") ||
    lc.includes("vaneck") ||
    lc.includes("ucits") ||
    lc.includes("ucit") ||
    / etf[^a-z]/i.test(` ${s} `) ||
    / etc[^a-z]/i.test(` ${s} `)
  ) {
    return "ETF/ETC";
  }

  // Rule 3: Crypto ETPs
  if (
    lc.includes("bitwise") ||
    lc.includes("bitcoin") ||
    lc.includes("ethereum") ||
    lc.includes("solana")
  ) {
    return "Crypto ETP";
  }

  // Rule 4: Corporate bond heuristic (e.g., "CARRARO FINANCE FX 5.25% APR30")
  if (/\d+\.?\d+%/.test(s)) {
    return "Bond";
  }

  return null;
}

async function classifyWithClaude(unknowns: string[]): Promise<Record<string, Tipo>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || unknowns.length === 0) {
    return Object.fromEntries(unknowns.map((s) => [s, "Stock" as Tipo]));
  }

  const list = unknowns.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const prompt = `Classify each security name from Italian statement data into exactly one category:
- Stock (individual listed company shares)
- ETF/ETC (equity ETFs, physical commodity ETCs, broad-market index funds)
- Crypto ETP (crypto exchange-traded products: Bitcoin, Ethereum, Solana)
- Bond (government and corporate bonds, BOT, BTP, CCT, fixed-rate instruments)
- Cash (cash balance entry "Saldo Iniziale" only)
- Other (anything else)

Securities to classify:
${list}

Respond with ONLY a valid JSON object mapping each exact security name to its category:
{"NAME": "Category", ...}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
    const data = (await resp.json()) as { content: { type: string; text: string }[] };
    const text = data.content.find((c) => c.type === "text")?.text ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? (JSON.parse(match[0]) as Record<string, string>) : {};
    const VALID: Tipo[] = ["Stock", "ETF/ETC", "Crypto ETP", "Bond", "Cash", "Other"];
    return Object.fromEntries(
      unknowns.map((s) => [s, (VALID.includes(parsed[s] as Tipo) ? (parsed[s] as Tipo) : "Stock")])
    );
  } catch {
    return Object.fromEntries(unknowns.map((s) => [s, "Stock" as Tipo]));
  }
}

export async function buildTipoMap(securityNames: string[]): Promise<Record<string, Tipo>> {
  const result: Record<string, Tipo> = {};
  const needsDb: string[] = [];

  for (const name of securityNames) {
    if (!name) continue;
    if (SEED_CACHE[name]) { result[name] = SEED_CACHE[name]; continue; }
    const ruled = classifyByRules(name);
    if (ruled) { result[name] = ruled; continue; }
    needsDb.push(name);
  }

  if (needsDb.length === 0) return result;

  let stillUnknown = [...needsDb];

  if (dbEnabled()) {
    try {
      const prisma = getPrisma();
      const cached = await prisma.security_tipo_cache.findMany({
        where: { security_name: { in: needsDb } },
        select: { security_name: true, tipo: true },
      });
      for (const { security_name, tipo } of cached) {
        result[security_name] = tipo as Tipo;
      }
      stillUnknown = needsDb.filter((n) => !result[n]);
    } catch {
      // ignore — cache miss is fine
    }
  }

  if (stillUnknown.length > 0) {
    const llm = await classifyWithClaude(stillUnknown);
    Object.assign(result, llm);
    if (dbEnabled()) {
      const prisma = getPrisma();
      for (const [name, tipo] of Object.entries(llm)) {
        await prisma.security_tipo_cache.upsert({
          where: { security_name: name },
          create: { security_name: name, tipo },
          update: {},
        }).catch(() => {});
      }
    }
  }

  return result;
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

// Ports split_semicolon: handles semicolons inside quoted fields.
function splitSemicolon(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; cur += ch; }
    else if (ch === ";" && !inQuotes) { parts.push(cur); cur = ""; }
    else { cur += ch; }
  }
  parts.push(cur);
  return parts;
}

// Ports parse_number: "1.234,56" → 1234.56
function parseItalianNumber(value: string): number | null {
  const v = value.trim().replace(/^"|"$/g, "");
  if (!v) return null;
  const normalized = v.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

// Ports parse_date: "DD/MM/YYYY" → Date
function parseItalianDate(value: string): Date | null {
  const v = value.trim().replace(/^"|"$/g, "");
  if (!v) return null;
  const parts = v.split("/");
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d);
  }
  return null;
}

// Ports get_transaction_type
function getTransactionType(
  security: string,
  reference: string,
  qty: number | null,
  amount: number | null
): string {
  if (security === "Saldo Iniziale") return "Balance";
  const ref = reference.toLowerCase();
  if (ref.includes("conferimento")) return "Deposit";
  if (ref.includes("prelievo")) return "Withdrawal";
  if (ref.includes("interessi prest")) return "Sec. Lending";
  if (ref.includes("incasso dividendi")) return "Dividend";
  if (ref.includes("cedola")) return "Coupon";
  if (ref.includes("rit.provento")) return "Tax";
  if (ref.includes("provento etf")) return "Distribution";
  if (ref.includes("rimborso obbl")) return "Redemption";
  if (ref.includes("bollo") || ref.includes("tobin") || ref.includes("rit.") || ref.includes("imposta")) return "Tax";
  if (qty !== null && qty > 0 && amount !== null && amount < 0) return "Buy";
  if (qty !== null && qty < 0 && amount !== null && amount > 0) return "Sell";
  if (amount !== null && amount < 0 && !security) return "Tax";
  return "Other";
}

export interface RawRow {
  sourceFile: string;
  fileDate: Date | null;
  date: Date;
  settlement: Date | null;
  security: string;
  isin?: string;
  reference: string;
  price: number | null;
  currency: string;
  quantity: number | null;
  amount: number | null;
  commission: number | null;
  type: string;
  tipo: Tipo | null;
}

export interface PositionPriceRow {
  sourceFile: string;
  fileDate: Date | null;
  security: string;
  isin?: string;
  quantity: number;
  price: number;
  marketValue: number;
}

type PositionMap = Map<string, PositionPriceRow>;

// Ports read_csv_files (single file variant)
export function parseCsvFile(content: string, filename: string): RawRow[] {
  // Detect file date from filename: "Estratto Conto YYYY-MM-DD.csv" or "Ec30_MM_YYYY.csv"
  let fileDate: Date | null = null;
  const m1 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) {
    fileDate = new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3]));
  } else {
    const m2 = filename.match(/Ec30_(\d{1,2})_(\d{4})/i);
    if (m2) {
      const month = parseInt(m2[1]);
      const year = parseInt(m2[2]);
      // Use last day of that month
      fileDate = new Date(year, month, 0);
    }
  }

  const lines = content.split(/\r?\n/);
  // Skip 4-line preamble (company info, period, blank, headers); data starts at index 4.
  const rows: RawRow[] = [];
  for (let i = 4; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = splitSemicolon(line);
    if (parts.length < 8) continue;
    const d = parseItalianDate(parts[0]);
    if (!d) continue;

    const security = parts[2].trim().replace(/^"|"$/g, "");
    const reference = parts[3].trim().replace(/^"|"$/g, "");
    const price = parseItalianNumber(parts[4]);
    const currency = parts[5].trim().replace(/^"|"$/g, "");
    const qty = parseItalianNumber(parts[6]);
    const amount = parseItalianNumber(parts[7]);
    const commission = parts.length > 8 ? parseItalianNumber(parts[8]) : null;
    const type = getTransactionType(security, reference, qty, amount);

    rows.push({
      sourceFile: filename,
      fileDate,
      date: d,
      settlement: parseItalianDate(parts[1]),
      security,
      isin: resolveIsin(security, reference),
      reference,
      price,
      currency,
      quantity: qty,
      amount,
      commission,
      type,
      tipo: null,
    });
  }
  return rows;
}

// ── Financial calculations ─────────────────────────────────────────────────────

export function parsePositionCsvFile(content: string, filename: string): PositionPriceRow[] {
  const finalRows = new Map<string, PositionPriceRow>();
  const totalRows = new Map<string, PositionPriceRow>();
  let fileDate: Date | null = null;

  const m1 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) {
    fileDate = new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3]));
  } else {
    const m2 = filename.match(/Ec(?:_X|30)?_(\d{1,2})_(\d{4})/i);
    if (m2) {
      fileDate = new Date(parseInt(m2[2]), parseInt(m2[1]), 0);
    }
  }

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = splitSemicolon(line);
    if (!fileDate) {
      const headerDate = parseItalianDate(parts[1] ?? "");
      if (headerDate) fileDate = headerDate;
    }
    const security = parts[1]?.trim().replace(/^"|"$/g, "") ?? "";
    const isin = resolveIsin(parts[0]?.trim().replace(/^"|"$/g, ""), security, parts[2]?.trim().replace(/^"|"$/g, ""));
    const marker = parts[5]?.trim().replace(/^"|"$/g, "") ?? "";
    const markerLower = marker.toLowerCase();
    if (!security || (markerLower !== "saldo finale" && markerLower !== "totale")) continue;

    const quantity = parseItalianNumber(parts[7] ?? "") ?? 0;
    const parsedPrice = parseItalianNumber(parts[8] ?? "");
    const marketValue = parseItalianNumber(parts[12] ?? "") ?? 0;
    const price = parsedPrice ?? (quantity !== 0 ? marketValue / quantity : 0);
    if (quantity === 0 && price === 0 && marketValue === 0) continue;

    const row = {
      sourceFile: filename,
      fileDate,
      security,
      isin,
      quantity,
      price,
      marketValue,
    };

    if (markerLower === "totale") {
      totalRows.set(security, row);
      continue;
    }

    const current = finalRows.get(security);
    if (!current) {
      finalRows.set(security, row);
      continue;
    }

    const quantityTotal = current.quantity + row.quantity;
    const marketValueTotal = current.marketValue + row.marketValue;
    finalRows.set(security, {
      sourceFile: filename,
      fileDate,
      security,
      isin: current.isin || row.isin,
      quantity: quantityTotal,
      price: quantityTotal !== 0 && marketValueTotal > 0 ? marketValueTotal / quantityTotal : row.price || current.price,
      marketValue: marketValueTotal,
    });
  }

  const securities = new Set([...finalRows.keys(), ...totalRows.keys()]);
  return [...securities].map((security) => totalRows.get(security) ?? finalRows.get(security)!);
}

function val(v: number | null | undefined): number {
  return v ?? 0;
}

function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function formatDateOnly(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function tipoFromAssetClass(assetClass: string): Tipo {
  const normalized = assetClass.toLowerCase();
  if (normalized.includes("bond")) return "Bond";
  if (normalized.includes("crypto")) return "Crypto ETP";
  if (normalized.includes("etf") || normalized.includes("etc")) return "ETF/ETC";
  if (normalized.includes("cash")) return "Cash";
  if (normalized.includes("stock") || normalized.includes("equity")) return "Stock";
  return "Other";
}

function openingRowsFromBaseline(baseline: BaselineSnapshotInput | undefined): RawRow[] {
  if (!baseline) return [];
  const baselineDate = parseDateOnly(baseline.cutoffDate);
  return baseline.holdings
    .filter((holding) => holding.shares > 0 && holding.marketValue > 0)
    .map((holding) => {
      const avgCostBasis = holding.avgCost > 0 ? holding.avgCost * holding.shares : 0;
      const costBasis = holding.costBasis > 0 ? holding.costBasis : avgCostBasis || holding.marketValue;
      const currentPrice = holding.currentPrice > 0 ? holding.currentPrice : holding.marketValue / holding.shares;
      return {
        sourceFile: "published snapshot opening positions",
        fileDate: baselineDate,
        date: baselineDate,
        settlement: null,
        security: holding.security,
        isin: holding.isin || resolveIsin(holding.security),
        reference: "Opening position from published snapshot",
        price: currentPrice,
        currency: holding.currency || "EUR",
        quantity: holding.shares,
        amount: -costBasis,
        commission: 0,
        type: "Buy",
        tipo: tipoFromAssetClass(holding.assetClass),
      };
    });
}

function monthlyRowsFromBaseline(baseline: BaselineSnapshotInput | undefined): MonthlyReturnRow[] {
  if (!baseline) return [];
  return baseline.timeseries.map((point) => ({
    monthEnd: parseDateOnly(point.monthEnd),
    nav: point.nav,
    monthlyReturn: point.monthlyReturn,
    cumulativeReturn: point.cumulativeReturn,
  }));
}

function isNewerPosition(candidate: PositionPriceRow, current: PositionPriceRow | undefined): boolean {
  if (!current) return true;
  if (!candidate.fileDate || !current.fileDate) return !current.fileDate && !!candidate.fileDate;
  return candidate.fileDate >= current.fileDate;
}

function normalizedPositionPrice(position: PositionPriceRow, shares: number): number {
  if (position.marketValue > 0 && Math.abs(shares) > 0) {
    return position.marketValue / Math.abs(shares);
  }
  return position.price;
}

function normalizedFallbackPrice(price: number, avgCost: number, tipo: Tipo | null): number {
  if (tipo === "Bond" && price > 10 && avgCost > 0 && price > avgCost * 10) {
    return price / 100;
  }
  return price;
}

// Ports compute_holdings
function computeHoldingsFromRows(tradeRows: RawRow[], positions: PositionMap): HoldingRow[] {
  const groups = new Map<string, RawRow[]>();
  for (const r of tradeRows) {
    if (!["Buy", "Sell", "Redemption"].includes(r.type) || !r.security) continue;
    if (!groups.has(r.security)) groups.set(r.security, []);
    groups.get(r.security)!.push(r);
  }

  const holdings: HoldingRow[] = [];
  const totalMvRef = { v: 0 };

  for (const [security, secRows] of groups) {
    secRows.sort((a, b) => a.date.getTime() - b.date.getTime());
    const buyRows = secRows.filter((r) => r.type === "Buy");
    const sellRows = secRows.filter((r) => r.type === "Sell");
    const hasRedemption = secRows.some((r) => r.type === "Redemption");

    const buyQty = buyRows.reduce((s, r) => s + val(r.quantity), 0);
    const buyCost = -buyRows.reduce((s, r) => s + val(r.amount), 0); // amount is negative for buys
    const sellQty = sellRows.reduce((s, r) => s + val(r.quantity), 0); // negative quantities

    const shares = hasRedemption ? 0 : Math.round((buyQty + sellQty) * 1e8) / 1e8;
    const avgCost = buyQty > 0 ? buyCost / buyQty : 0;

    // Current valuation: trust Directa's official position market value when
    // available. Bond quoted prices can appear as percent prices or unit prices,
    // so reconstructing MV from price alone can create false ~90% losses.
    const lastRow = [...secRows].reverse().find((r) => r.price !== null);
    const position = positions.get(security);
    const tipo = secRows[secRows.length - 1].tipo;
    const isin = position?.isin || secRows.find((r) => r.isin)?.isin || resolveIsin(security);
    const fallbackPrice = normalizedFallbackPrice(lastRow?.price ?? 0, avgCost, tipo);
    const currentPrice = position ? normalizedPositionPrice(position, shares) : fallbackPrice;

    const marketValue = position?.marketValue && shares > 0
      ? position.marketValue
      : shares * currentPrice;
    const costBasis = shares !== 0 ? shares * avgCost : 0;
    const unrealizedPnl = shares !== 0 ? marketValue - costBasis : 0;
    const pnlPct = costBasis > 0 ? unrealizedPnl / costBasis : 0;

    totalMvRef.v += marketValue;

    holdings.push({
      security,
      isin,
      assetClass: tipo ?? "Stock",
      currency: secRows[secRows.length - 1].currency || "EUR",
      shares,
      avgCost: Math.round(avgCost * 1e6) / 1e6,
      costBasis: Math.round(costBasis * 1e6) / 1e6,
      currentPrice: Math.round(currentPrice * 1e6) / 1e6,
      marketValue: Math.round(marketValue * 1e6) / 1e6,
      unrealizedPnl: Math.round(unrealizedPnl * 1e6) / 1e6,
      pnlPct: Math.round(pnlPct * 1e8) / 1e8,
      weight: 0,
    });
  }

  // Back-fill weights
  const totalMv = totalMvRef.v;
  for (const h of holdings) {
    h.weight = totalMv > 0 ? Math.round((h.marketValue / totalMv) * 1e8) / 1e8 : 0;
  }

  return holdings;
}

// Ports get_cash_at_cutoff
export function getCashAtCutoff(rows: RawRow[], cutoff: Date): number {
  const balanceRows = rows.filter((r) => r.type === "Balance" && r.date <= cutoff);
  if (balanceRows.length === 0) return 0;
  const lastBalance = balanceRows.reduce((a, b) => (a.date >= b.date ? a : b));
  let cash = val(lastBalance.amount);
  for (const r of rows) {
    if (r.type !== "Balance" && r.date >= lastBalance.date && r.date <= cutoff) {
      cash += val(r.amount) + val(r.commission);
    }
  }
  return Math.round(cash * 100) / 100;
}

// Ports compute_monthly_returns
function computeMonthlyReturnsFromRows(
  rows: RawRow[],
  cutoff: Date,
  positions: PositionMap,
  previousNav: number | null = null
): MonthlyReturnRow[] {
  // Collect unique month-end dates from Balance rows, keyed by ISO date string to avoid duplicates.
  const meMap = new Map<string, Date>();
  for (const r of rows) {
    if (r.type !== "Balance" || r.date > cutoff) continue;
    const me = monthEnd(r.date);
    const key = `${me.getFullYear()}-${me.getMonth()}-${me.getDate()}`;
    if (!meMap.has(key)) meMap.set(key, me);
  }
  const monthEnds = [...meMap.values()].sort((a, b) => a.getTime() - b.getTime());

  const result: MonthlyReturnRow[] = [];
  let prevValue: number | null = previousNav;
  let cumulative = 0;

  for (const me of monthEnds) {
    const meKey = `${me.getFullYear()}-${me.getMonth()}-${me.getDate()}`;
    const isCurrentMonth =
      me.getFullYear() === cutoff.getFullYear() && me.getMonth() === cutoff.getMonth();
    const value = getAccountValueAtCutoff(rows, me, isCurrentMonth ? positions : undefined);

    const rowMonthKey = (r: RawRow) => {
      const m = monthEnd(r.date);
      return `${m.getFullYear()}-${m.getMonth()}-${m.getDate()}`;
    };
    const deposits = rows
      .filter((r) => r.type === "Deposit" && rowMonthKey(r) === meKey)
      .reduce((s, r) => s + val(r.amount), 0);
    const withdrawals = rows
      .filter((r) => r.type === "Withdrawal" && rowMonthKey(r) === meKey)
      .reduce((s, r) => s + val(r.amount), 0);

    let monthlyReturn = 0;
    if (prevValue !== null && prevValue !== 0) {
      monthlyReturn = (value - deposits - withdrawals) / prevValue - 1;
    }
    cumulative = prevValue === null ? monthlyReturn : (1 + cumulative) * (1 + monthlyReturn) - 1;

    result.push({
      monthEnd: me,
      nav: Math.round(value * 1e6) / 1e6,
      monthlyReturn: Math.round(monthlyReturn * 1e8) / 1e8,
      cumulativeReturn: Math.round(cumulative * 1e8) / 1e8,
    });
    prevValue = value;
  }

  return result;
}

function getAccountValueAtCutoff(
  rows: RawRow[],
  cutoff: Date,
  positions?: PositionMap
): number {
  const cash = getCashAtCutoff(rows, cutoff);
  const bySecurity = new Map<string, { shares: number; price: number; tipo: Tipo | null; buyQty: number; buyCost: number }>();

  for (const r of rows) {
    if (r.date > cutoff || !r.security || !["Buy", "Sell", "Redemption"].includes(r.type)) continue;
    const current = bySecurity.get(r.security) ?? { shares: 0, price: 0, tipo: null, buyQty: 0, buyCost: 0 };
    current.tipo = r.tipo ?? current.tipo;
    const rowPrice = val(r.price);
    if (rowPrice > 0) current.price = rowPrice;
    if (r.type === "Redemption") {
      const redeemedQuantity = Math.abs(val(r.quantity));
      current.shares = redeemedQuantity > 0 ? current.shares - redeemedQuantity : 0;
      bySecurity.set(r.security, current);
      continue;
    }
    if (r.type === "Buy") {
      current.buyQty += val(r.quantity);
      current.buyCost += -val(r.amount);
    }
    current.shares += val(r.quantity);
    bySecurity.set(r.security, current);
  }

  let holdingsValue = 0;
  for (const [security, position] of bySecurity) {
    if (position.shares <= 0) continue;
    const officialPosition = positions?.get(security);
    if (officialPosition?.marketValue && officialPosition.marketValue > 0) {
      holdingsValue += officialPosition.marketValue;
      continue;
    }
    const avgCost = position.buyQty > 0 ? position.buyCost / position.buyQty : 0;
    const price = normalizedFallbackPrice(position.price, avgCost, position.tipo);
    holdingsValue += position.shares * price;
  }

  return Math.round((cash + holdingsValue) * 1e6) / 1e6;
}

function computeRealizedPnlFromRows(tradeRows: RawRow[]): number {
  const groups = new Map<string, RawRow[]>();
  for (const r of tradeRows) {
    if (!["Buy", "Sell", "Redemption"].includes(r.type) || !r.security) continue;
    if (!groups.has(r.security)) groups.set(r.security, []);
    groups.get(r.security)!.push(r);
  }

  let realized = 0;
  for (const secRows of groups.values()) {
    const buyRows = secRows.filter((r) => r.type === "Buy");
    const buyQty = buyRows.reduce((s, r) => s + val(r.quantity), 0);
    if (buyQty <= 0) continue;

    const buyCost = -buyRows.reduce((s, r) => s + val(r.amount), 0);
    const avgCost = buyCost / buyQty;

    for (const r of secRows) {
      if (!["Sell", "Redemption"].includes(r.type)) continue;
      const soldQty = Math.abs(val(r.quantity));
      if (soldQty <= 0) continue;
      const proceeds = val(r.amount) + val(r.commission);
      realized += proceeds - soldQty * avgCost;
    }
  }

  return Math.round(realized * 1e6) / 1e6;
}

// Builds investor IRR cash flows (deposits/withdrawals, negated: deposits → negative from investor view)
function buildInvestorIrrFlows(rows: RawRow[]): CashFlowRow[] {
  const byDate = new Map<string, { date: Date; net: number }>();
  for (const r of rows) {
    if (!["Deposit", "Withdrawal"].includes(r.type)) continue;
    const key = formatDateOnly(r.date);
    if (!byDate.has(key)) byDate.set(key, { date: r.date, net: 0 });
    byDate.get(key)!.net += val(r.amount);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((v) => ({ date: v.date, cashFlow: -v.net }));
}

// Builds portfolio IRR cash flows (trade-level, raw broker signs: buy=negative, sell=positive)
function buildPortfolioIrrFlows(rows: RawRow[]): CashFlowRow[] {
  const PORTFOLIO_TYPES = ["Buy", "Sell", "Dividend", "Coupon", "Distribution", "Redemption", "Sec. Lending"];
  const byDate = new Map<string, { date: Date; flow: number }>();
  for (const r of rows) {
    if (!PORTFOLIO_TYPES.includes(r.type)) continue;
    const key = formatDateOnly(r.date);
    if (!byDate.has(key)) byDate.set(key, { date: r.date, flow: 0 });
    byDate.get(key)!.flow += val(r.amount) + val(r.commission);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((v) => ({ date: v.date, cashFlow: Math.round(v.flow * 1e6) / 1e6 }));
}

// ── Main entry point ───────────────────────────────────────────────────────────

export interface AdminOverlays {
  nonListedValue: number;
  externalCash: number;
  capitalCommitted: number;
  baselineSnapshot?: BaselineSnapshotInput | null;
}

export interface BaselineSnapshotInput {
  cutoffDate: string;
  totalPortfolioValue: number;
  holdings: Holding[];
  timeseries: NavPoint[];
}

export async function buildWorkbookDataFromParsedRows(
  parsedRows: RawRow[],
  parsedPositions: PositionPriceRow[],
  overlays: AdminOverlays
): Promise<WorkbookData> {
  // Step 1: combine the published baseline opening rows with persisted Directa rows.
  const allRows: RawRow[] = [
    ...openingRowsFromBaseline(overlays.baselineSnapshot ?? undefined),
    ...parsedRows,
  ];
  const positions: PositionMap = new Map();
  for (const row of parsedPositions) {
    if (row.price > 0 || row.marketValue > 0) {
      const current = positions.get(row.security);
      if (isNewerPosition(row, current)) positions.set(row.security, row);
    }
  }
  allRows.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Step 2: classify securities
  const securityNames = [...new Set(allRows.map((r) => r.security).filter(Boolean))];
  const tipoMap = await buildTipoMap(securityNames);
  for (const r of allRows) {
    r.tipo = r.security ? (tipoMap[r.security] ?? "Stock") : null;
  }

  // Step 3: cutoff date = max file date across all uploaded CSVs
  const fileDates = allRows.map((r) => r.fileDate).filter((d): d is Date => d !== null);
  const cutoff = fileDates.length > 0 ? fileDates.reduce((a, b) => (a >= b ? a : b)) : new Date();

  const tradeRows = allRows.filter((r) => r.date <= cutoff);

  // Step 4: compute holdings
  const holdings = computeHoldingsFromRows(tradeRows, positions);
  const listedMarketValue = holdings.reduce((s, h) => s + h.marketValue, 0);

  // Step 5: cash
  const statementCash = getCashAtCutoff(allRows, cutoff);
  const externalCash = overlays.externalCash;
  const totalCash = statementCash + externalCash;

  // Step 6: portfolio total
  const portfolioValue = listedMarketValue + overlays.nonListedValue + totalCash;

  // Step 7: income & fee totals
  const dividends = tradeRows.filter((r) => r.type === "Dividend").reduce((s, r) => s + val(r.amount) + val(r.commission), 0);
  const coupons = tradeRows.filter((r) => r.type === "Coupon").reduce((s, r) => s + val(r.amount) + val(r.commission), 0);
  const distributions = tradeRows.filter((r) => r.type === "Distribution").reduce((s, r) => s + val(r.amount) + val(r.commission), 0);
  const lending = tradeRows.filter((r) => r.type === "Sec. Lending").reduce((s, r) => s + val(r.amount) + val(r.commission), 0);
  const totalIncome = dividends + coupons + distributions + lending;

  const invested = tradeRows.filter((r) => r.type === "Deposit").reduce((s, r) => s + val(r.amount), 0);
  const withdrawals = Math.abs(tradeRows.filter((r) => r.type === "Withdrawal").reduce((s, r) => s + val(r.amount), 0));
  const unrealizedPnl = holdings.reduce((s, h) => s + h.unrealizedPnl, 0);
  const realizedPnl = computeRealizedPnlFromRows(tradeRows);
  const netPnl = portfolioValue + withdrawals - invested;

  // Step 8: monthly returns
  const incrementalMonthlyReturns = computeMonthlyReturnsFromRows(
    allRows,
    cutoff,
    positions,
    overlays.baselineSnapshot?.totalPortfolioValue ?? null
  );
  const baselineMonthlyReturns = monthlyRowsFromBaseline(overlays.baselineSnapshot ?? undefined);
  const firstIncrementalMonth = incrementalMonthlyReturns[0]?.monthEnd ?? null;
  const monthlyReturns = [
    ...baselineMonthlyReturns.filter(
      (row) => !firstIncrementalMonth || row.monthEnd < firstIncrementalMonth
    ),
    ...incrementalMonthlyReturns,
  ];

  // Step 9: annualized return for portfolioMetrics fallback
  const rets = monthlyReturns.map((r) => r.monthlyReturn);
  const lastCum = monthlyReturns[monthlyReturns.length - 1]?.cumulativeReturn ?? 0;
  const annualizedReturn = rets.length > 1 ? Math.pow(1 + lastCum, 12 / rets.length) - 1 : 0;

  // Step 10: IRR cash flows (used by computeIRR in calculations.ts)
  const irrInvestor = buildInvestorIrrFlows(tradeRows);
  const irrPortfolio = buildPortfolioIrrFlows(tradeRows);

  // Step 11: Trade log for computeDistributions / computeKPIs
  const tradeLog = tradeRows
    .filter((r) => r.type !== "Balance")
    .map((r) => ({
      date: r.date,
      security: r.security,
      assetClass: r.tipo ?? "Other",
      currency: r.currency || "EUR",
      type: r.type,
      shares: val(r.quantity),
      price: val(r.price),
      netAmount: (() => {
        // Report convention (matches Python report_trade_net_amount)
        const a = val(r.amount);
        const c = val(r.commission);
        if (r.type === "Buy") return Math.abs(a) + Math.abs(c);
        if (r.type === "Sell" || r.type === "Redemption") return -(Math.abs(a + c));
        return a + c;
      })(),
    }));

  // portfolioMetrics: populate all keys that calculations.ts looks up
  const portfolioMetrics: Record<string, number | string> = {
    "Total Portfolio Value": portfolioValue,
    "Capital Committed": overlays.capitalCommitted,
    "Total Income (Div+Cpn+Dist)": totalIncome,
    "Total Cash": totalCash,
    "Statement Cash": statementCash,
    "External Cash": externalCash,
    "Listed Market Value": listedMarketValue,
    "Non-Listed Value": overlays.nonListedValue,
    "Unrealized P&L": unrealizedPnl,
    "Realized P&L": realizedPnl,
    "Net Total P&L": netPnl,
    "Annualized Return (TWR)": annualizedReturn,
    "Total Market Value (Holdings)": listedMarketValue,
  };

  return { tradeLog, holdings, portfolioMetrics, irrInvestor, irrPortfolio, monthlyReturns, cutoffDate: cutoff, investorPerformance: [] };
}

export async function buildWorkbookData(
  csvFiles: { name: string; content: string }[],
  overlays: AdminOverlays
): Promise<WorkbookData> {
  const parsedRows: RawRow[] = [];
  const parsedPositions: PositionPriceRow[] = [];
  for (const f of csvFiles) {
    parsedRows.push(...parseCsvFile(f.content, f.name));
    parsedPositions.push(...parsePositionCsvFile(f.content, f.name));
  }

  return buildWorkbookDataFromParsedRows(parsedRows, parsedPositions, overlays);
}
