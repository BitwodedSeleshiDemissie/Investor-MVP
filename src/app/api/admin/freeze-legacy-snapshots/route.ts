/**
 * POST /api/admin/freeze-legacy-snapshots
 *
 * One-time migration: stamps overlaysFrozen = TRUE on every unfrozen published
 * Directa snapshot. Does NOT modify any financial numbers.
 */
import { NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import type { InvestorPerf, PortfolioSnapshot } from "@/types/portfolio";
import type { Prisma } from "@/generated/prisma/client";

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const prisma = getPrisma();

  const unfrozen = await prisma.$queryRaw<Array<{ id: bigint; payload: PortfolioSnapshot }>>`
    SELECT id, payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
      AND overlays_frozen = FALSE
      AND COALESCE(source_file, '') NOT ILIKE 'CEO tracker context:%'
    ORDER BY as_of_date ASC
  `;

  if (unfrozen.length === 0) {
    return NextResponse.json({ ok: true, frozen: 0, message: "No unfrozen snapshots found." });
  }

  const [ctrlRows, manualRows, profileRows] = await Promise.all([
    prisma.admin_controls.findFirst({
      orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
      select: { capital_committed: true, portfolio_id: true, investor_name: true },
    }),
    prisma.$queryRaw<Array<{ item_key: string; item_type: string; value: string }>>`
      SELECT DISTINCT ON (mv.item_key)
        mv.item_key, d.item_type, mv.value::text AS value
      FROM admin_manual_values mv
      JOIN asset_dictionary d ON d.item_key = mv.item_key
      WHERE d.active = TRUE
      ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
    `,
    prisma.investor_profiles.findMany({
      where: { active: true },
      orderBy: [{ subscription_date: "asc" }, { name: "asc" }],
      select: { name: true, investor_type: true, capital_eur: true, units: true, subscription_date: true, nav_unit_at_sub: true },
    }),
  ]);

  const nonListedValue = manualRows
    .filter((r) => r.item_type.toLowerCase() !== "cash")
    .reduce((s, r) => s + Number(r.value), 0);
  const externalCash = manualRows
    .filter((r) => r.item_type.toLowerCase() === "cash")
    .reduce((s, r) => s + Number(r.value), 0);
  const capitalCommitted = ctrlRows ? Number(ctrlRows.capital_committed) : 0;
  const frozenAt = new Date().toISOString();

  const frozenIds: number[] = [];
  const beforeAfter: Array<{
    id: number;
    cutoffDate: string;
    navBefore: number;
    navAfter: number;
    investorPerfCountBefore: number;
    investorPerfCountAfter: number;
  }> = [];

  for (const row of unfrozen) {
    const snap: PortfolioSnapshot = JSON.parse(JSON.stringify(row.payload));
    const navBefore = snap.kpis.totalPortfolioValue;
    const perfCountBefore = snap.investorPerformance?.length ?? 0;

    if (!snap.investorPerformance || snap.investorPerformance.length === 0) {
      if (profileRows.length > 0) {
        const totalUnits = profileRows.reduce((s, p) => s + p.units, 0);
        const navUnit = totalUnits > 0 ? snap.kpis.totalPortfolioValue / totalUnits : 0;
        const cutoffTs = new Date(snap.cutoffDate);
        snap.investorPerformance = profileRows.map((p): InvestorPerf => {
          const capitalEur = p.capital_eur;
          const units = p.units;
          const subscriptionDate = String(p.subscription_date).split("T")[0];
          const yearsElapsed = (cutoffTs.getTime() - new Date(subscriptionDate).getTime()) / (365.25 * 24 * 3600 * 1000);
          const currentValueEur = units * navUnit;
          const moic = capitalEur > 0 ? currentValueEur / capitalEur : 0;
          const irrAnnualized = yearsElapsed > 0 && moic > 0 ? Math.pow(moic, 1 / yearsElapsed) - 1 : 0;
          return {
            name: p.name, type: p.investor_type, subscriptionDate,
            capitalEur, units, yearsElapsed, navUnitAtSub: p.nav_unit_at_sub,
            currentValueEur, moic, irrAnnualized,
          };
        });
      } else {
        snap.investorPerformance = [];
      }
    }

    snap.overlaysFrozen = true;
    snap.frozenAt = frozenAt;
    snap.overlaySources = {
      capitalCommitted, nonListedValue, externalCash,
      overlayItemCount: manualRows.length,
      investorProfileCount: profileRows.length,
    };
    snap.warnings = (snap.warnings ?? []).filter((w) => !w.startsWith("LEGACY_SNAPSHOT:"));

    if (snap.kpis.totalPortfolioValue !== navBefore) {
      return NextResponse.json(
        { error: `ABORT: snapshot ${Number(row.id)} NAV changed during freeze (${navBefore} → ${snap.kpis.totalPortfolioValue}). This is a bug — do not proceed.` },
        { status: 500 }
      );
    }

    await prisma.portfolio_snapshots.update({
      where: { id: row.id },
      data: { payload: snap as unknown as Prisma.InputJsonValue, overlays_frozen: true },
    });

    frozenIds.push(Number(row.id));
    beforeAfter.push({
      id: Number(row.id),
      cutoffDate: snap.cutoffDate,
      navBefore,
      navAfter: snap.kpis.totalPortfolioValue,
      investorPerfCountBefore: perfCountBefore,
      investorPerfCountAfter: snap.investorPerformance.length,
    });
  }

  return NextResponse.json({
    ok: true,
    frozen: frozenIds.length,
    snapshotIds: frozenIds,
    beforeAfter,
    message: `Froze ${frozenIds.length} snapshot(s). Financial numbers were not modified.`,
  });
}
