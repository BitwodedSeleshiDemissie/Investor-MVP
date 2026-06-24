import type { PrismaClient } from "@/generated/prisma/client";
import type { WorkbookData } from "./workbook-data";

export type LedgerHolding = {
  isin: string;
  netQty: number;
  avgCost: number | null;
  totalBuyQty: number;
  totalBuyEur: number;
  totalSellQty: number;
};

export async function computeLedgerHoldings(
  prisma: PrismaClient,
  asOfDate: string
): Promise<Map<string, LedgerHolding>> {
  const rows = await prisma.transaction.findMany({
    where: {
      tradeDate: { lte: new Date(`${asOfDate}T23:59:59.999Z`) },
      type: { in: ["BUY", "OPENING", "SELL"] },
      securityIsin: { not: null },
    },
    select: { securityIsin: true, type: true, quantity: true, eurAmount: true },
  });

  const acc = new Map<string, { buyQty: number; buyEur: number; sellQty: number }>();
  for (const row of rows) {
    if (!row.securityIsin) continue;
    const isin = row.securityIsin;
    if (!acc.has(isin)) acc.set(isin, { buyQty: 0, buyEur: 0, sellQty: 0 });
    const e = acc.get(isin)!;
    const qty = Number(row.quantity);
    const eur = Number(row.eurAmount);
    if (row.type === "BUY" || row.type === "OPENING") {
      e.buyQty += qty;
      e.buyEur += eur;
    } else {
      e.sellQty += qty;
    }
  }

  const result = new Map<string, LedgerHolding>();
  for (const [isin, e] of acc) {
    result.set(isin, {
      isin,
      netQty: Math.round((e.buyQty - e.sellQty) * 1e8) / 1e8,
      avgCost: e.buyQty > 0 ? e.buyEur / e.buyQty : null,
      totalBuyQty: e.buyQty,
      totalBuyEur: e.buyEur,
      totalSellQty: e.sellQty,
    });
  }
  return result;
}

export function injectLedgerCostBasis(
  workbook: WorkbookData,
  ledger: Map<string, LedgerHolding>
): void {
  const byIsin = new Map(
    workbook.holdings.filter((h) => h.isin).map((h) => [h.isin!, h])
  );

  for (const [isin, h] of ledger) {
    if (h.netQty <= 0 || h.avgCost === null) continue;
    const avgCost = Math.round(h.avgCost * 1e6) / 1e6;
    const costBasis = Math.round(avgCost * h.netQty * 1e6) / 1e6;
    const existing = byIsin.get(isin);
    if (existing) {
      existing.avgCost = avgCost;
      existing.costBasis = costBasis;
    } else {
      // Security has ledger history but no CSV rows this month; stub so
      // applyPdfListedPositions can find its costBasis by ISIN.
      workbook.holdings.push({
        security: isin,
        isin,
        assetClass: "Other",
        currency: "EUR",
        shares: h.netQty,
        avgCost,
        costBasis,
        currentPrice: 0,
        marketValue: 0,
        unrealizedPnl: 0,
        pnlPct: 0,
        weight: 0,
      });
    }
  }
}
