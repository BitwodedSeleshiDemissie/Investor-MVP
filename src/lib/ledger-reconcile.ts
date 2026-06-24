import type { DirectaPdfPosition } from "./directa-pdf";
import type { LedgerHolding } from "./ledger-compute";

export type ReconcileEntry = {
  isin: string;
  security: string;
  ledgerNetQty: number;
  pdfQty: number;
  delta: number;
  pdfMarketValue: number;
  severity: "MATCH" | "WARN" | "BLOCKER";
  reason: string;
};

export type ReconcileReport = {
  passed: boolean;
  mvDeltaRaw: number;
  mvDeltaAdjusted: number;
  isinMatchCount: number;
  isinWarnCount: number;
  isinBlockerCount: number;
  entries: ReconcileEntry[];
  summary: string;
};

const KNOWN_LEDGER_SHORTFALLS: Record<string, { expectedDelta: number; reason: string }> = {
  IE00B7J7TB45: { expectedDelta: -12, reason: "Base short 12 sh — pre-Excel-seed history missing from iShares Global Corp Bond" },
  IE00BYZK4883: { expectedDelta: -113, reason: "Base short 113 sh — pre-Excel-seed history missing from iShares Digitalisation" },
  LU1681039480: { expectedDelta: -2, reason: "Base short 2 sh — pre-Excel-seed history missing from Amundi FTSE EPRA EUR Real Est" },
  NL0009690239: { expectedDelta: -24, reason: "Base short 24 sh — pre-Excel-seed history missing from VanEck Global Real Estate" },
};

const KNOWN_PDF_ONLY: Record<string, { expectedPdfQty: number; reason: string }> = {
  IE00BJK55C48: { expectedPdfQty: 1000, reason: "Placeholder VERIFY-IHYG-5.82 in Excel seed; admin to confirm ISIN and insert correction rows" },
};

export function reconcile(
  ledgerHoldings: Map<string, LedgerHolding>,
  pdfPositions: DirectaPdfPosition[]
): ReconcileReport {
  const entries: ReconcileEntry[] = [];
  let knownMvExcluded = 0;
  let blockerCount = 0;

  const pdfByIsin = new Map<string, DirectaPdfPosition>();
  for (const pos of pdfPositions) {
    if (pos.isin) pdfByIsin.set(pos.isin, pos);
  }

  // Check every ISIN that appears in the PDF.
  for (const [isin, pos] of pdfByIsin) {
    const ledger = ledgerHoldings.get(isin);
    const ledgerNetQty = ledger?.netQty ?? 0;
    const pdfQty = pos.quantity;
    const delta = Math.round((ledgerNetQty - pdfQty) * 1e8) / 1e8;

    if (delta === 0) {
      entries.push({ isin, security: pos.security, ledgerNetQty, pdfQty, delta, pdfMarketValue: pos.marketValue, severity: "MATCH", reason: "Exact match" });
      continue;
    }

    const shortfall = KNOWN_LEDGER_SHORTFALLS[isin];
    if (shortfall) {
      if (delta === shortfall.expectedDelta) {
        knownMvExcluded += pos.marketValue;
        entries.push({ isin, security: pos.security, ledgerNetQty, pdfQty, delta, pdfMarketValue: pos.marketValue, severity: "WARN", reason: `Known shortfall (expected delta ${shortfall.expectedDelta}): ${shortfall.reason}` });
      } else {
        blockerCount++;
        entries.push({ isin, security: pos.security, ledgerNetQty, pdfQty, delta, pdfMarketValue: pos.marketValue, severity: "BLOCKER", reason: `KNOWN_LEDGER_SHORTFALLS mismatch: expected delta ${shortfall.expectedDelta}, got ${delta} — investigate before publishing` });
      }
      continue;
    }

    const pdfOnly = KNOWN_PDF_ONLY[isin];
    if (pdfOnly) {
      if (ledgerNetQty === 0 && pdfQty === pdfOnly.expectedPdfQty) {
        knownMvExcluded += pos.marketValue;
        entries.push({ isin, security: pos.security, ledgerNetQty, pdfQty, delta, pdfMarketValue: pos.marketValue, severity: "WARN", reason: `Known PDF-only: ${pdfOnly.reason}` });
      } else {
        blockerCount++;
        entries.push({ isin, security: pos.security, ledgerNetQty, pdfQty, delta, pdfMarketValue: pos.marketValue, severity: "BLOCKER", reason: `KNOWN_PDF_ONLY mismatch: expected ledger=0 pdfQty=${pdfOnly.expectedPdfQty}, got ledger=${ledgerNetQty} pdf=${pdfQty}` });
      }
      continue;
    }

    // Unexpected mismatch — hard blocker.
    blockerCount++;
    entries.push({ isin, security: pos.security, ledgerNetQty, pdfQty, delta, pdfMarketValue: pos.marketValue, severity: "BLOCKER", reason: `Unexpected qty mismatch: ledger ${ledgerNetQty}, PDF ${pdfQty}, delta ${delta > 0 ? "+" : ""}${delta}` });
  }

  // Any ISIN in the ledger with netQty > 0 that is absent from the PDF is also a blocker.
  for (const [isin, holding] of ledgerHoldings) {
    if (holding.netQty <= 0) continue;
    if (pdfByIsin.has(isin)) continue;
    blockerCount++;
    entries.push({ isin, security: isin, ledgerNetQty: holding.netQty, pdfQty: 0, delta: holding.netQty, pdfMarketValue: 0, severity: "BLOCKER", reason: `Ledger has ${holding.netQty} shares but ISIN absent from PDF` });
  }

  // MV gate: compare ledger-priced MV to PDF total, excluding known-warn ISINs.
  // For MATCH entries ledgerNetQty === pdfQty, so MV at PDF prices = pos.marketValue
  // (using the pre-computed PDF value avoids bond price-convention issues where price
  // is expressed as % of par, not EUR per unit).
  const pdfTotalMv = pdfPositions.reduce((s, p) => s + p.marketValue, 0);
  const ledgerMvForMatchedIsins = entries
    .filter((e) => e.severity === "MATCH")
    .reduce((s, e) => s + e.pdfMarketValue, 0);

  // Raw delta = sum of matched-ISIN PDF MVs vs total PDF MV (before exclusions).
  const mvDeltaRaw = Math.round((ledgerMvForMatchedIsins - pdfTotalMv) * 100) / 100;
  // Adjusted: add back the known-warn ISINs' PDF market values to make the comparison fair.
  const mvDeltaAdjusted = Math.round((mvDeltaRaw + knownMvExcluded) * 100) / 100;

  if (Math.abs(mvDeltaAdjusted) > 1.0) {
    blockerCount++;
  }

  entries.sort((a, b) => {
    const order = { BLOCKER: 0, WARN: 1, MATCH: 2 };
    return order[a.severity] - order[b.severity];
  });

  const matchCount = entries.filter((e) => e.severity === "MATCH").length;
  const warnCount = entries.filter((e) => e.severity === "WARN").length;
  const blockerEntries = entries.filter((e) => e.severity === "BLOCKER");
  const passed = blockerCount === 0;

  const summary = passed
    ? `Reconciliation passed: ${matchCount}/${pdfPositions.length} ISIN qty exact matches, ${warnCount} known warnings, adjusted MV delta €${mvDeltaAdjusted.toFixed(2)}`
    : `Reconciliation BLOCKED (${blockerEntries.length} issue(s)): ${blockerEntries.map((e) => `${e.isin} — ${e.reason}`).join(" | ")}`;

  return {
    passed,
    mvDeltaRaw,
    mvDeltaAdjusted,
    isinMatchCount: matchCount,
    isinWarnCount: warnCount,
    isinBlockerCount: blockerEntries.length,
    entries,
    summary,
  };
}
