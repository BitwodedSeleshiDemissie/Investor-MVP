/**
 * GET /api/admin/snapshot-baseline
 *
 * Returns the exact numbers currently served by getPortfolioSnapshot():
 * raw stored payload (no live overlay reads) for the latest published snapshot.
 */
import { NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import type { PortfolioSnapshot } from "@/types/portfolio";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{
    id: bigint;
    as_of_date: Date;
    publication_status: string;
    overlays_frozen: boolean;
    payload: PortfolioSnapshot;
  }>>`
    SELECT id, as_of_date, publication_status, overlays_frozen, payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
      AND COALESCE(source_file, '') NOT ILIKE 'CEO tracker context:%'
    ORDER BY as_of_date DESC, created_at DESC
    LIMIT 1
  `;

  if (!rows[0]) {
    return NextResponse.json({ error: "No published snapshot found" }, { status: 404 });
  }

  const row = rows[0];
  const p = row.payload;

  return NextResponse.json({
    snapshotId: Number(row.id),
    asOfDate: row.as_of_date,
    cutoffDate: p.cutoffDate,
    overlaysFrozen: row.overlays_frozen,
    frozenAt: p.frozenAt ?? null,
    totalNav: p.kpis.totalPortfolioValue,
    capitalCommitted: p.kpis.capitalCommitted,
    fundIrr: p.irr?.fundIrr ?? null,
    investorIrr: p.irr?.investorIrr ?? null,
    composition: {
      listed: p.composition.listed,
      nonListed: p.composition.nonListed,
      cash: p.composition.cash,
      total: p.composition.total,
    },
    investorPerformance: (p.investorPerformance ?? []).map((inv) => ({
      name: inv.name,
      capitalEur: inv.capitalEur,
      currentValueEur: inv.currentValueEur,
      moic: inv.moic,
      irrAnnualized: inv.irrAnnualized,
      subscriptionDate: inv.subscriptionDate,
    })),
    liveOverlaySnapshot: await buildLiveOverlayAudit(),
  });
}

async function buildLiveOverlayAudit() {
  const prisma = getPrisma();
  const ctrl = await prisma.admin_controls.findFirst({
    orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
    select: { capital_committed: true, portfolio_id: true, investor_name: true },
  });
  const manual = await prisma.$queryRaw<Array<{
    item_key: string;
    item_type: string;
    value: string;
    as_of_date: string;
  }>>`
    SELECT DISTINCT ON (mv.item_key)
      mv.item_key, d.item_type, mv.value::text, mv.as_of_date::text
    FROM admin_manual_values mv
    JOIN asset_dictionary d ON d.item_key = mv.item_key
    WHERE d.active = TRUE
    ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
  `;
  return { adminControls: ctrl ?? null, manualValues: manual };
}
