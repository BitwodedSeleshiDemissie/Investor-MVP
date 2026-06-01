import { getPrisma } from "../../db/prisma";
import {
  checkWarnings,
  computeAllocation,
  computeComposition,
  computeDistributions,
  computeHoldings,
  computeIRR,
  computeKPIs,
  computeRisk,
  computeTargets,
  computeTimeseries,
} from "../../lib/calculations";
import { calculationSettings, getFundSettings } from "../fund-settings";
import { buildWorkbookCashFormula } from "../cash-formula";
import type { WorkbookData } from "../../lib/excel-loader";
import type { InvestorPerf, PortfolioSnapshot } from "../../types/portfolio";
import type { Prisma } from "../../generated/prisma/client";

type ManualSeedRow = {
  itemKey: string;
  displayName: string;
  itemType: "Non-Listed" | "Cash";
  subcategory: string;
  value: number;
  notes: string;
  sortOrder: number;
};

export type CeoTrackerImportResult = {
  ok: true;
  skipped: boolean;
  snapshotId: number;
  cutoffDate: string;
  publicationStatus: "published";
  overlaysFrozen: true;
  investorCount: number;
  portfolioValue: number;
  fundIrr: number | null;
  composition: { listed: number; nonListed: number; cash: number; total: number };
  warnings: string[];
  message: string;
};

export class CeoTrackerImportError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

function numMetric(metrics: Record<string, number | string>, ...keys: string[]): number {
  for (const key of keys) {
    const value = metrics[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function dateOnly(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function optionalEnvNumber(name: string): number | null {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestWorkbookSourceDate(workbookData: WorkbookData, fallbackDate: string): string {
  const fallback = new Date(`${fallbackDate}T00:00:00`);
  const dates = [
    ...workbookData.tradeLog.map((row) => row.date),
    ...workbookData.monthlyReturns.map((row) => row.monthEnd),
  ].filter((date) => Number.isFinite(date.getTime()) && date <= fallback);

  if (dates.length === 0) return fallbackDate;
  return dateOnly(dates.reduce((a, b) => (a >= b ? a : b)));
}

function buildManualSeedRows(
  workbookData: WorkbookData,
  nonListedTotal: number,
  baselineDirectaCash: number | null
): ManualSeedRow[] {
  const detailedRows = (workbookData.manualItems ?? []).filter(
    (row) => row.itemType === "Non-Listed" && Number.isFinite(row.value) && row.value > 0
  );
  const rows: ManualSeedRow[] = [...detailedRows];

  if (rows.length === 0) {
    const metrics = workbookData.portfolioMetrics;
    const loans = numMetric(metrics, "Loans Outstanding", "Prestiti Outstanding EUR");
    const participations = Math.max(0, nonListedTotal - loans);
    if (participations > 0) {
      rows.push({
        itemKey: "CEO_TRACKER_PARTICIPATIONS",
        displayName: "CEO Tracker Participations",
        itemType: "Non-Listed",
        subcategory: "Participation",
        value: participations,
        notes: "Seeded from CEO tracker partecipazioni current-value formula",
        sortOrder: 10,
      });
    }
    if (loans > 0) {
      rows.push({
        itemKey: "CEO_TRACKER_PRIVATE_LOANS",
        displayName: "CEO Tracker Private Loans",
        itemType: "Non-Listed",
        subcategory: "Private Loan",
        value: loans,
        notes: "Seeded from CEO tracker prestiti outstanding formula",
        sortOrder: 20,
      });
    }
  }

  const totalCash = numMetric(workbookData.portfolioMetrics, "Total Cash", "Cash", "Cassa EUR");
  if (baselineDirectaCash !== null) {
    const externalCashDifference = Math.max(0, totalCash - baselineDirectaCash);
    if (externalCashDifference > 0) {
      rows.push({
        itemKey: "TRACKER_EXTERNAL_CASH_DIFFERENCE",
        displayName: "External Cash Difference",
        itemType: "Cash",
        subcategory: "Outside Directa Cash",
        value: externalCashDifference,
        notes: "Seeded as CEO tracker cash less baseline Directa statement cash",
        sortOrder: 900,
      });
    }
  }
  return rows;
}

function manualSum(rows: ManualSeedRow[], itemType: ManualSeedRow["itemType"]): number {
  return rows.filter((row) => row.itemType === itemType).reduce((sum, row) => sum + row.value, 0);
}

function isParticipationSeed(row: ManualSeedRow): boolean {
  const subcategory = row.subcategory.toLowerCase();
  return row.itemType === "Non-Listed" && (
    subcategory.includes("participation") ||
    row.itemKey.startsWith("TRACKER_PARTICIPATION_") ||
    row.itemKey === "CEO_TRACKER_PARTICIPATIONS" ||
    row.itemKey === "PRIVATE_PARTICIPATIONS"
  );
}

function isPrivateLoanSeed(row: ManualSeedRow): boolean {
  const subcategory = row.subcategory.toLowerCase();
  return row.itemType === "Non-Listed" && (
    subcategory.includes("loan") ||
    row.itemKey.startsWith("TRACKER_LOAN_") ||
    row.itemKey === "CEO_TRACKER_PRIVATE_LOANS" ||
    row.itemKey === "PRIVATE_LOAN_PRINCIPAL"
  );
}

function parseSnapshot(value: unknown): PortfolioSnapshot | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as PortfolioSnapshot;
    } catch {
      return null;
    }
  }
  return value as PortfolioSnapshot;
}

function resultFromSnapshot(
  snapshotId: number,
  payload: PortfolioSnapshot,
  skipped: boolean
): CeoTrackerImportResult {
  return {
    ok: true,
    skipped,
    snapshotId,
    cutoffDate: payload.cutoffDate,
    publicationStatus: "published",
    overlaysFrozen: true,
    investorCount: payload.investorPerformance.length,
    portfolioValue: payload.kpis.totalPortfolioValue,
    fundIrr: payload.irr.fundIrr,
    composition: {
      listed: payload.composition.listed,
      nonListed: payload.composition.nonListed,
      cash: payload.composition.cash,
      total: payload.composition.total,
    },
    warnings: payload.warnings,
    message: skipped
      ? `CEO tracker baseline already exists as snapshot ${snapshotId}.`
      : `CEO tracker workbook imported and published as snapshot ${snapshotId}. ${payload.investorPerformance.length} investor profile(s) upserted.`,
  };
}

async function latestCeoBaseline(): Promise<{ id: number; payload: PortfolioSnapshot } | null> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{ id: bigint; payload: PortfolioSnapshot }>>`
    SELECT id, payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
      AND payload->'overlaySources'->>'source' = 'CEO tracker workbook'
    ORDER BY as_of_date DESC, created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  const payload = parseSnapshot(row?.payload);
  if (!row || !payload) return null;
  return { id: Number(row.id), payload };
}

async function refreshExistingCeoBaseline(
  snapshotId: number,
  payload: PortfolioSnapshot,
  workbookData: WorkbookData,
  fileName: string
): Promise<PortfolioSnapshot> {
  const refreshed: PortfolioSnapshot = {
    ...payload,
    holdings: computeHoldings(workbookData),
    dataFreshness: {
      lastUploadAt: payload.dataFreshness?.lastUploadAt ?? payload.frozenAt ?? null,
      transactionsThrough: latestWorkbookSourceDate(workbookData, payload.cutoffDate),
      positionsAsOf: payload.dataFreshness?.positionsAsOf ?? payload.cutoffDate,
      sourceFiles: [fileName],
    },
  };
  const prisma = getPrisma();
  await prisma.portfolio_snapshots.update({
    where: { id: BigInt(snapshotId) },
    data: { payload: refreshed as unknown as Prisma.InputJsonValue },
  });
  return refreshed;
}

export async function importCeoTrackerWorkbook({
  workbookData,
  fileName,
  approvedBy,
  approvalNote = "CEO tracker workbook import",
  baselineDirectaCash = optionalEnvNumber("BASELINE_DIRECTA_CASH"),
  skipIfSeeded = false,
}: {
  workbookData: WorkbookData;
  fileName: string;
  approvedBy: string;
  approvalNote?: string;
  baselineDirectaCash?: number | null;
  skipIfSeeded?: boolean;
}): Promise<CeoTrackerImportResult> {
  if (skipIfSeeded) {
    const existing = await latestCeoBaseline();
    if (existing) {
      const refreshed = await refreshExistingCeoBaseline(existing.id, existing.payload, workbookData, fileName);
      return resultFromSnapshot(existing.id, refreshed, true);
    }
  }

  if (workbookData.investorPerformance.length === 0) {
    throw new CeoTrackerImportError(
      "Sheet 12_Perf_Investitori contains no investor rows. A CEO tracker snapshot requires per-investor metrics.",
      422
    );
  }

  const cutoffDate = dateOnly(workbookData.cutoffDate);
  const fundSettings = await getFundSettings();
  const settings = calculationSettings(fundSettings);
  const kpis = computeKPIs(workbookData, settings);
  const composition = computeComposition(workbookData);
  const frozenAt = new Date().toISOString();
  const manualSeedRows = buildManualSeedRows(workbookData, composition.nonListed, baselineDirectaCash);
  const externalCash = manualSum(manualSeedRows, "Cash");
  const cashFormula = buildWorkbookCashFormula(workbookData.portfolioMetrics, cutoffDate);

  const investorPerformance: InvestorPerf[] = workbookData.investorPerformance.map((p) => ({
    name: p.name,
    type: p.type,
    subscriptionDate: dateOnly(p.subscriptionDate),
    capitalEur: p.capitalEur,
    units: p.units,
    yearsElapsed: p.yearsElapsed,
    navUnitAtSub: p.navUnitAtSub,
    currentValueEur: p.currentValueEur,
    moic: p.moic,
    irrAnnualized: p.irrAnnualized,
  }));

  const payload: PortfolioSnapshot = {
    kpis,
    timeseries: computeTimeseries(workbookData),
    allocation: computeAllocation(workbookData),
    irr: computeIRR(workbookData),
    risk: computeRisk(workbookData, settings),
    distributions: computeDistributions(workbookData),
    targets: computeTargets(workbookData, settings),
    holdings: computeHoldings(workbookData),
    composition,
    pnl: {
      unrealized: Number(workbookData.portfolioMetrics["Unrealized P&L"] ?? 0),
      realized: Number(workbookData.portfolioMetrics["Realized P&L"] ?? 0),
      netTotal: Number(workbookData.portfolioMetrics["Net Total P&L"] ?? 0),
    },
    directaCash: baselineDirectaCash ?? Number(
      workbookData.portfolioMetrics["Statement Cash"] ??
        workbookData.portfolioMetrics["Directa Cash"] ??
        workbookData.portfolioMetrics["Total Cash"] ??
        workbookData.portfolioMetrics["Cash"] ??
        0
    ),
    cutoffDate,
    dataFreshness: {
      lastUploadAt: frozenAt,
      transactionsThrough: latestWorkbookSourceDate(workbookData, cutoffDate),
      positionsAsOf: cutoffDate,
      sourceFiles: [fileName],
    },
    investorName: fundSettings.fundDisplayName,
    portfolioId: fundSettings.portfolioId,
    warnings: checkWarnings(workbookData),
    investorPerformance,
    overlaysFrozen: true,
    frozenAt,
    overlaySources: {
      capitalCommitted: kpis.capitalCommitted,
      nonListedValue: composition.nonListed,
      externalCash,
      overlayItemCount: manualSeedRows.length,
      investorProfileCount: investorPerformance.length,
      cashFormula: cashFormula ?? undefined,
      manualItems: manualSeedRows.map((row) => ({
        item_key: row.itemKey,
        item_type: row.itemType,
        value: row.value,
        value_date: cutoffDate,
        display_name: row.displayName,
        subcategory: row.subcategory,
      })),
      source: "CEO tracker workbook",
    },
  };

  const prisma = getPrisma();
  const activeKeys = manualSeedRows.map((row) => row.itemKey);

  const result = await prisma.$transaction(async (tx) => {
    await tx.admin_controls.create({
      data: {
        portfolio_id: fundSettings.portfolioId,
        investor_name: fundSettings.fundDisplayName,
        as_of_date: new Date(cutoffDate),
        capital_committed: kpis.capitalCommitted,
        currency: "EUR",
        notes: "Seeded from CEO tracker workbook",
      },
    });

    for (const p of workbookData.investorPerformance) {
      const subDate = dateOnly(p.subscriptionDate);
      await tx.investor_profiles.upsert({
        where: { name: p.name },
        create: {
          name: p.name,
          investor_type: p.type,
          capital_eur: p.capitalEur,
          units: p.units,
          subscription_date: new Date(subDate),
          nav_unit_at_sub: p.navUnitAtSub,
          active: true,
          notes: "Upserted from CEO tracker workbook",
          updated_at: new Date(),
        },
        update: {
          investor_type: p.type,
          capital_eur: p.capitalEur,
          units: p.units,
          subscription_date: new Date(subDate),
          nav_unit_at_sub: p.navUnitAtSub,
          active: true,
          notes: "Upserted from CEO tracker workbook",
          updated_at: new Date(),
        },
      });
    }

    if (activeKeys.length > 0) {
      await tx.$executeRaw`
        UPDATE asset_dictionary
        SET active = FALSE, updated_at = NOW()
        WHERE (
          item_key LIKE 'TRACKER_PARTICIPATION_%'
          OR item_key LIKE 'TRACKER_LOAN_%'
          OR item_key IN ('CEO_TRACKER_PARTICIPATIONS', 'CEO_TRACKER_PRIVATE_LOANS', 'TRACKER_EXTERNAL_CASH_DIFFERENCE')
        )
        AND NOT (item_key = ANY(${activeKeys}::text[]))
      `;
    } else {
      await tx.$executeRaw`
        UPDATE asset_dictionary
        SET active = FALSE, updated_at = NOW()
        WHERE (
          item_key LIKE 'TRACKER_PARTICIPATION_%'
          OR item_key LIKE 'TRACKER_LOAN_%'
          OR item_key IN ('CEO_TRACKER_PARTICIPATIONS', 'CEO_TRACKER_PRIVATE_LOANS', 'TRACKER_EXTERNAL_CASH_DIFFERENCE')
        )
      `;
    }

    for (const row of manualSeedRows) {
      await tx.asset_dictionary.upsert({
        where: { item_key: row.itemKey },
        create: {
          item_key: row.itemKey,
          display_name: row.displayName,
          item_type: row.itemType,
          subcategory: row.subcategory,
          currency: "EUR",
          active: true,
          sort_order: row.sortOrder,
          notes: row.notes,
          updated_at: new Date(),
        },
        update: {
          display_name: row.displayName,
          item_type: row.itemType,
          subcategory: row.subcategory,
          currency: "EUR",
          active: true,
          sort_order: row.sortOrder,
          notes: row.notes,
          updated_at: new Date(),
        },
      });
      await tx.admin_manual_values.create({
        data: {
          as_of_date: new Date(cutoffDate),
          item_key: row.itemKey,
          value: row.value,
          currency: "EUR",
          valuation_source: "CEO tracker workbook",
          valuation_method: row.subcategory,
          notes: row.notes,
        },
      });
      if (isParticipationSeed(row)) {
        const exists = await tx.non_listed_transactions.findFirst({
          where: {
            transaction_date: new Date(cutoffDate),
            tipo: "BUY",
            investee: row.displayName,
            amount: row.value,
          },
        });
        if (!exists) {
          await tx.non_listed_transactions.create({
            data: {
              transaction_date: new Date(cutoffDate),
              tipo: "BUY",
              investee: row.displayName,
              currency: "EUR",
              amount: row.value,
            },
          });
        }
      } else if (isPrivateLoanSeed(row)) {
        const exists = await tx.private_loan_transactions.findFirst({
          where: {
            transaction_date: new Date(cutoffDate),
            tipo: "DISBURSEMENT",
            counterparty: row.displayName,
            amount: row.value,
          },
        });
        if (!exists) {
          await tx.private_loan_transactions.create({
            data: {
              transaction_date: new Date(cutoffDate),
              tipo: "DISBURSEMENT",
              counterparty: row.displayName,
              currency: "EUR",
              amount: row.value,
            },
          });
        }
      }
    }

    return tx.portfolio_snapshots.create({
      data: {
        as_of_date: new Date(cutoffDate),
        source_file: fileName,
        payload: payload as unknown as Prisma.InputJsonValue,
        publication_status: "published",
        published_at: new Date(),
        approved_by: approvedBy,
        approval_note: approvalNote,
        overlays_frozen: true,
      },
      select: { id: true },
    });
  }, { timeout: 30_000 });

  return resultFromSnapshot(Number(result.id), payload, false);
}
