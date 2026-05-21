"use server";

import { z } from "zod";
import { adminAction } from "@/lib/safe-action";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { xirrSafe } from "@/lib/calculations";
import {
  getFundSettings,
  saveFundSettings as persistFundSettings,
  type FundSettings,
} from "@/server/fund-settings";
import {
  inferLegacyCashFormulaBase,
  recalculateCashFormula,
} from "@/server/cash-formula";
import type { AllocationSlice, InvestorPerf, PortfolioSnapshot } from "@/types/portfolio";
import type { Prisma } from "@/generated/prisma/client";

const dictionarySchema = z.object({
  itemKey: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  itemType: z.enum(["non_listed", "cash"]),
  subcategory: z.string().optional(),
  currency: z.string().length(3).default("EUR"),
  sortOrder: z.number().int().default(0),
});

const manualValueSchema = z.object({
  itemKey: z.string().min(1),
  displayName: z.string().min(1),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.coerce.number().nonnegative(),
  holdingName: z.string().optional(),
});

const controlSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capitalCommitted: z.coerce.number().nonnegative(),
});

const fundSettingsSchema = z.object({
  portfolioId: z.string().min(1).max(100),
  fundDisplayName: z.string().min(1).max(200),
  baseCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  subscriptionPricingPolicy: z.string().min(1).max(200),
  riskFreeRatePct: z.coerce.number().min(0).max(100),
  moicTarget: z.coerce.number().positive(),
  targetEquityPct: z.coerce.number().min(0).max(100),
  targetBondPct: z.coerce.number().min(0).max(100),
  targetAltPct: z.coerce.number().min(0).max(100),
  hurdleRatePct: z.coerce.number().min(0).max(100),
  gpCarryPct: z.coerce.number().min(0).max(100),
  catchUpGpTargetPct: z.coerce.number().min(0).max(100),
}).refine((value) => {
  const sum = value.targetEquityPct + value.targetBondPct + value.targetAltPct;
  return Math.abs(sum - 100) < 0.000001;
}, {
  message: "Allocation targets must add up to 100%.",
  path: ["targetAltPct"],
});

function pctToDecimal(value: number): number {
  return value / 100;
}

export const saveDictionaryItem = adminAction
  .schema(dictionarySchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const dbItemType = parsedInput.itemType === "cash" ? "Cash" : "Non-Listed";
    await prisma.asset_dictionary.upsert({
      where: { item_key: parsedInput.itemKey },
      create: {
        item_key: parsedInput.itemKey,
        display_name: parsedInput.displayName,
        item_type: dbItemType,
        subcategory: parsedInput.subcategory ?? "",
        currency: parsedInput.currency,
        active: true,
        sort_order: parsedInput.sortOrder,
        notes: "",
        updated_at: new Date(),
      },
      update: {
        display_name: parsedInput.displayName,
        item_type: dbItemType,
        subcategory: parsedInput.subcategory ?? "",
        currency: parsedInput.currency,
        active: true,
        sort_order: parsedInput.sortOrder,
        updated_at: new Date(),
      },
    });
    return { success: true };
  });

export const saveManualValue = adminAction
  .schema(manualValueSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const dictEntry = await prisma.asset_dictionary.findUnique({
      where: { item_key: parsedInput.itemKey },
      select: { item_type: true },
    });
    const itemType = dictEntry?.item_type?.toLowerCase() ?? "";
    const valuationMethod = itemType === "cash" ? "Monthly cash value" : "Monthly approved value";

    await prisma.admin_manual_values.create({
      data: {
        as_of_date: new Date(parsedInput.valueDate),
        item_key: parsedInput.itemKey,
        value: parsedInput.value,
        currency: "EUR",
        valuation_source: "Admin input",
        valuation_method: valuationMethod,
        notes: parsedInput.holdingName ?? "",
      },
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

export const saveControl = adminAction
  .schema(controlSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const settings = await getFundSettings();
    await prisma.admin_controls.create({
      data: {
        portfolio_id: settings.portfolioId,
        investor_name: settings.fundDisplayName,
        as_of_date: new Date(parsedInput.asOfDate),
        capital_committed: parsedInput.capitalCommitted,
        currency: "EUR",
        notes: "Admin-entered official capital commitment",
      },
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

export const saveFundSettings = adminAction
  .schema(fundSettingsSchema)
  .action(async ({ parsedInput, ctx }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const settings: FundSettings = {
      portfolioId: parsedInput.portfolioId.trim(),
      fundDisplayName: parsedInput.fundDisplayName.trim(),
      baseCurrency: parsedInput.baseCurrency,
      subscriptionPricingPolicy: parsedInput.subscriptionPricingPolicy.trim(),
      riskFreeRate: pctToDecimal(parsedInput.riskFreeRatePct),
      moicTarget: parsedInput.moicTarget,
      targetEquityPct: pctToDecimal(parsedInput.targetEquityPct),
      targetBondPct: pctToDecimal(parsedInput.targetBondPct),
      targetAltPct: pctToDecimal(parsedInput.targetAltPct),
      hurdleRate: pctToDecimal(parsedInput.hurdleRatePct),
      gpCarryPct: pctToDecimal(parsedInput.gpCarryPct),
      catchUpGpTargetPct: pctToDecimal(parsedInput.catchUpGpTargetPct),
    };
    await persistFundSettings(settings, ctx.session.email ?? "admin");
    return { success: true };
  });

export const deleteDictionaryItem = adminAction
  .schema(z.object({ itemKey: z.string() }))
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    await prisma.asset_dictionary.update({
      where: { item_key: parsedInput.itemKey },
      data: { active: false, updated_at: new Date() },
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

const investorProfileSchema = z.object({
  name: z.string().min(1).max(200),
  investorType: z.string().min(1).max(100).default("Individual"),
  capitalEur: z.coerce.number().nonnegative(),
  units: z.coerce.number().nonnegative(),
  subscriptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  navUnitAtSub: z.coerce.number().nonnegative().default(1.0),
  notes: z.string().optional(),
});

function slugKey(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "INVESTEE";
}

type ManualSnapshotItem = {
  item_key: string;
  item_type: string;
  value: number;
  value_date: string;
  display_name: string;
  subcategory: string | null;
};

function parsePayload(value: unknown): PortfolioSnapshot | null {
  if (!value) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as PortfolioSnapshot; } catch { return null; }
  }
  return value as PortfolioSnapshot;
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  return value.includes("T") ? value.split("T")[0] : value;
}

function classifyAllocation(assetClass: string): "equity" | "bond" | "alt" | "cash" {
  const label = assetClass.toLowerCase();
  if (label.includes("cash")) return "cash";
  if (label.includes("bond") || label.includes("fixed")) return "bond";
  if (label.includes("stock") || label.includes("equity")) return "equity";
  return "alt";
}

function recomputeAllocation(
  existing: AllocationSlice[],
  nonListedValue: number,
  cashValue: number,
  totalValue: number
): AllocationSlice[] {
  const base = existing.filter((slice) => {
    const label = slice.assetClass.toLowerCase();
    return label !== "cash" && label !== "non-listed";
  });
  if (nonListedValue > 0) base.push({ assetClass: "Non-Listed", marketValue: nonListedValue, weight: 0 });
  if (cashValue > 0) base.push({ assetClass: "Cash", marketValue: cashValue, weight: 0 });
  return base
    .map((slice) => ({ ...slice, weight: totalValue > 0 ? slice.marketValue / totalValue : 0 }))
    .sort((a, b) => b.marketValue - a.marketValue);
}

function recomputeTargets(
  existing: PortfolioSnapshot["targets"],
  allocation: AllocationSlice[],
  totalValue: number
): PortfolioSnapshot["targets"] {
  const buckets = { equity: 0, bond: 0, alt: 0, cash: 0 };
  for (const slice of allocation) {
    buckets[classifyAllocation(slice.assetClass)] += slice.marketValue;
  }
  return {
    ...existing,
    currentEquityPct: totalValue > 0 ? buckets.equity / totalValue : 0,
    currentBondPct: totalValue > 0 ? buckets.bond / totalValue : 0,
    currentAltPct: totalValue > 0 ? buckets.alt / totalValue : 0,
    currentCashPct: totalValue > 0 ? buckets.cash / totalValue : 0,
  };
}

function computeProfileFundIrr(
  profiles: Array<{ capital_eur: number; subscription_date: Date | string }>,
  cutoffDate: string,
  currentNav: number
): number | null {
  if (currentNav <= 0 || profiles.length === 0) return null;
  const cashflows = profiles
    .map((profile) => {
      const rawDate = dateOnly(profile.subscription_date);
      return { date: new Date(`${rawDate}T00:00:00Z`), amount: -Number(profile.capital_eur) };
    })
    .filter((cf) => Number.isFinite(cf.amount) && cf.amount < 0 && Number.isFinite(cf.date.getTime()));
  if (cashflows.length === 0) return null;
  cashflows.sort((a, b) => a.date.getTime() - b.date.getTime());
  cashflows.push({ date: new Date(`${cutoffDate}T00:00:00Z`), amount: currentNav });
  return xirrSafe(cashflows);
}

async function getCurrentManualSnapshotItems(): Promise<ManualSnapshotItem[]> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{
    item_key: string;
    display_name: string;
    item_type: string;
    subcategory: string | null;
    value: string;
    value_date: string;
  }>>`
    WITH has_detailed_participations AS (
      SELECT EXISTS (
        SELECT 1 FROM admin_manual_values WHERE item_key LIKE 'TRACKER_PARTICIPATION_%'
      ) AS yes
    ),
    has_detailed_loans AS (
      SELECT EXISTS (
        SELECT 1 FROM admin_manual_values WHERE item_key LIKE 'TRACKER_LOAN_%'
      ) AS yes
    ),
    has_cash_override AS (
      SELECT EXISTS (
        SELECT 1 FROM admin_manual_values WHERE item_key = 'CASH_OUTSIDE_DIRECTA'
      ) AS yes
    )
    SELECT
      d.item_key,
      d.display_name,
      d.item_type,
      d.subcategory,
      mv.value::text AS value,
      mv.as_of_date::text AS value_date
    FROM asset_dictionary d
    JOIN LATERAL (
      SELECT value, as_of_date
      FROM admin_manual_values
      WHERE item_key = d.item_key
      ORDER BY as_of_date DESC, created_at DESC
      LIMIT 1
    ) mv ON TRUE
    WHERE d.active = TRUE
      AND NOT (
        d.item_key IN ('PRIVATE_PARTICIPATIONS', 'CEO_TRACKER_PARTICIPATIONS')
        AND (SELECT yes FROM has_detailed_participations)
      )
      AND NOT (
        d.item_key IN ('PRIVATE_LOAN_PRINCIPAL', 'CEO_TRACKER_PRIVATE_LOANS')
        AND (SELECT yes FROM has_detailed_loans)
      )
      AND NOT (
        d.item_key = 'TRACKER_EXTERNAL_CASH_DIFFERENCE'
        AND (SELECT yes FROM has_cash_override)
      )
    ORDER BY d.sort_order, d.item_key
  `;

  return rows
    .map((row) => ({
      item_key: row.item_key,
      item_type: row.item_type,
      value: Number(row.value),
      value_date: dateOnly(row.value_date),
      display_name: row.display_name,
      subcategory: row.subcategory,
    }))
    .filter((row) => Number.isFinite(row.value) && row.value >= 0);
}

async function getPostCutoffCashFormulaDeltas(cutoffDate: string): Promise<{
  participationNetCost: number;
  loanNetPrincipal: number;
}> {
  const prisma = getPrisma();
  const cutoff = new Date(cutoffDate);
  const [participationRows, loanRows] = await Promise.all([
    prisma.$queryRaw<Array<{ net_amount: string | number | null }>>`
      SELECT COALESCE(SUM(
        CASE
          WHEN tipo = 'BUY' THEN amount
          WHEN tipo = 'SELL' THEN -amount
          ELSE 0
        END
      ), 0)::text AS net_amount
      FROM non_listed_transactions
      WHERE transaction_date > ${cutoff}
    `,
    prisma.$queryRaw<Array<{ net_amount: string | number | null }>>`
      SELECT COALESCE(SUM(
        CASE
          WHEN tipo = 'DISBURSEMENT' THEN amount
          WHEN tipo = 'REPAYMENT' THEN -amount
          ELSE 0
        END
      ), 0)::text AS net_amount
      FROM private_loan_transactions
      WHERE transaction_date > ${cutoff}
    `,
  ]);

  return {
    participationNetCost: Number(participationRows[0]?.net_amount ?? 0),
    loanNetPrincipal: Number(loanRows[0]?.net_amount ?? 0),
  };
}

export async function syncCurrentApprovedSnapshot(): Promise<void> {
  if (!dbEnabled()) return;
  const prisma = getPrisma();

  const snapshotRows = await prisma.$queryRaw<Array<{ id: bigint; payload: PortfolioSnapshot }>>`
    SELECT id, payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
    ORDER BY as_of_date DESC, created_at DESC
    LIMIT 1
  `;
  const snapshotId = snapshotRows[0]?.id;
  const payload = parsePayload(snapshotRows[0]?.payload);
  if (!snapshotId || !payload) return;

  const [manualItems, profileRows, controlRow] = await Promise.all([
    getCurrentManualSnapshotItems(),
    prisma.investor_profiles.findMany({
      where: { active: true },
      orderBy: [{ subscription_date: "asc" }, { name: "asc" }],
      select: { name: true, investor_type: true, capital_eur: true, units: true, subscription_date: true, nav_unit_at_sub: true },
    }),
    prisma.admin_controls.findFirst({
      orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
      select: { capital_committed: true, portfolio_id: true, investor_name: true },
    }),
  ]);

  const nonListedValue = manualItems
    .filter((item) => item.item_type.toLowerCase() !== "cash")
    .reduce((sum, item) => sum + item.value, 0);
  const externalCash = manualItems
    .filter((item) => item.item_type.toLowerCase() === "cash")
    .reduce((sum, item) => sum + item.value, 0);
  const listed = Number(payload.composition?.listed ?? payload.holdings.reduce((sum, h) => sum + h.marketValue, 0));
  const statementCash = Number(payload.directaCash ?? 0);
  const explicitCashOverride = manualItems.some((item) => item.item_key === "CASH_OUTSIDE_DIRECTA");
  const formulaBase = payload.overlaySources?.cashFormula ?? inferLegacyCashFormulaBase(payload);
  const formulaDeltas = await getPostCutoffCashFormulaDeltas(formulaBase.baseCutoffDate || payload.cutoffDate);
  const cashFormula = recalculateCashFormula(
    {
      ...formulaBase,
      capitalCollected: Number(controlRow?.capital_committed ?? formulaBase.capitalCollected),
    },
    formulaDeltas.participationNetCost,
    formulaDeltas.loanNetPrincipal
  );
  const cash = explicitCashOverride ? statementCash + externalCash : Math.max(0, cashFormula.cash);
  const effectiveExternalCash = Math.max(0, cash - statementCash);
  const total = listed + nonListedValue + cash;
  const capitalCommitted = Number(controlRow?.capital_committed ?? payload.overlaySources?.capitalCommitted ?? payload.kpis.capitalCommitted ?? 0);
  const totalIncome = Number(payload.kpis.totalIncome ?? 0);

  payload.composition = { listed, nonListed: nonListedValue, cash, total };
  payload.kpis = {
    ...payload.kpis,
    totalPortfolioValue: total,
    capitalCommitted,
    pctSinceEntry: capitalCommitted > 0 ? (total - capitalCommitted) / capitalCommitted : 0,
    moic: capitalCommitted > 0 ? (total + totalIncome) / capitalCommitted : 0,
    currentYield: total > 0 ? totalIncome / total : 0,
  };
  payload.holdings = payload.holdings.map((holding) => ({
    ...holding,
    weight: total > 0 ? holding.marketValue / total : 0,
  }));
  payload.allocation = recomputeAllocation(payload.allocation ?? [], nonListedValue, cash, total);
  payload.targets = recomputeTargets(payload.targets, payload.allocation, total);
  payload.overlaySources = {
    ...(payload.overlaySources ?? {
      capitalCommitted, nonListedValue, externalCash,
      overlayItemCount: manualItems.length, investorProfileCount: profileRows.length,
    }),
    capitalCommitted, nonListedValue, externalCash: effectiveExternalCash,
    overlayItemCount: manualItems.length,
    investorProfileCount: profileRows.length,
    cashFormula,
    manualItems: manualItems.map((item) => ({
      item_key: item.item_key, item_type: item.item_type, value: item.value,
      value_date: item.value_date, display_name: item.display_name, subcategory: item.subcategory,
    })),
  };

  if (profileRows.length > 0) {
    const totalUnits = profileRows.reduce((sum, p) => sum + p.units, 0);
    const navUnit = totalUnits > 0 ? total / totalUnits : 0;
    const cutoffTs = new Date(`${payload.cutoffDate}T00:00:00Z`);
    const profileFundIrr = computeProfileFundIrr(profileRows, payload.cutoffDate, total);
    if (profileFundIrr !== null) {
      payload.irr.fundIrr = profileFundIrr;
      payload.irr.investorIrr = profileFundIrr;
    }
    payload.investorPerformance = profileRows.map((profile): InvestorPerf => {
      const capitalEur = profile.capital_eur;
      const units = profile.units;
      const subscriptionDate = dateOnly(profile.subscription_date);
      const yearsElapsed = (cutoffTs.getTime() - new Date(`${subscriptionDate}T00:00:00Z`).getTime()) / (365.25 * 24 * 3600 * 1000);
      const currentValueEur = units * navUnit;
      const moic = capitalEur > 0 ? currentValueEur / capitalEur : 0;
      return {
        name: profile.name, type: profile.investor_type, subscriptionDate,
        capitalEur, units, yearsElapsed, navUnitAtSub: profile.nav_unit_at_sub,
        currentValueEur, moic,
        irrAnnualized: yearsElapsed > 0 && moic > 0 ? Math.pow(moic, 1 / yearsElapsed) - 1 : 0,
      };
    });
  }

  payload.frozenAt = new Date().toISOString();
  payload.overlaysFrozen = true;

  await prisma.portfolio_snapshots.update({
    where: { id: snapshotId },
    data: { payload: payload as unknown as Prisma.InputJsonValue, overlays_frozen: true },
  });
}

export const saveInvestorProfile = adminAction
  .schema(investorProfileSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    await prisma.investor_profiles.upsert({
      where: { name: parsedInput.name },
      create: {
        name: parsedInput.name,
        investor_type: parsedInput.investorType,
        capital_eur: parsedInput.capitalEur,
        units: parsedInput.units,
        subscription_date: new Date(parsedInput.subscriptionDate),
        nav_unit_at_sub: parsedInput.navUnitAtSub,
        active: true,
        notes: parsedInput.notes ?? "",
        updated_at: new Date(),
      },
      update: {
        investor_type: parsedInput.investorType,
        capital_eur: parsedInput.capitalEur,
        units: parsedInput.units,
        subscription_date: new Date(parsedInput.subscriptionDate),
        nav_unit_at_sub: parsedInput.navUnitAtSub,
        active: true,
        notes: parsedInput.notes ?? "",
        updated_at: new Date(),
      },
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

const nonListedValuesSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(["BUY", "SELL"]),
  investee: z.string().min(1).max(200),
  amount: z.coerce.number().positive(),
});

const privateLoanValuesSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(["DISBURSEMENT", "REPAYMENT"]),
  counterparty: z.string().min(1).max(200),
  amount: z.coerce.number().positive(),
});

function externalCashFromPayload(payload: PortfolioSnapshot | null): number {
  if (!payload) return 0;
  const cashItems = payload.overlaySources?.manualItems?.filter((item) => item.item_type.toLowerCase() === "cash") ?? [];
  const manualExternalCash = cashItems.reduce((sum, item) => sum + Number(item.value), 0);
  if (manualExternalCash > 0) return manualExternalCash;
  return Math.max(0, Number(payload.composition?.cash ?? 0) - Number(payload.directaCash ?? 0));
}

async function getCurrentExternalCashBalance(): Promise<number> {
  const prisma = getPrisma();
  const manualRow = await prisma.admin_manual_values.findFirst({
    where: { item_key: "CASH_OUTSIDE_DIRECTA" },
    orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
    select: { value: true },
  });
  if (manualRow) return manualRow.value;

  const snapshotRows = await prisma.$queryRaw<Array<{ payload: PortfolioSnapshot }>>`
    SELECT payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
    ORDER BY as_of_date DESC, created_at DESC
    LIMIT 1
  `;
  return externalCashFromPayload(parsePayload(snapshotRows[0]?.payload));
}

export const saveNonListedValues = adminAction
  .schema(nonListedValuesSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const investee = parsedInput.investee.trim();
    const itemKey = `TRACKER_PARTICIPATION_${slugKey(investee)}`;

    const latest = await prisma.admin_manual_values.findFirst({
      where: { item_key: itemKey },
      orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
      select: { value: true },
    });
    const currentValue = latest?.value ?? 0;
    const nextValue = parsedInput.tipo === "BUY"
      ? currentValue + parsedInput.amount
      : currentValue - parsedInput.amount;

    if (nextValue < -0.000001) {
      return { error: `Sell amount exceeds the current approved value for ${investee}.` };
    }

    await prisma.$transaction(async (tx) => {
      await tx.asset_dictionary.upsert({
        where: { item_key: itemKey },
        create: {
          item_key: itemKey, display_name: investee, item_type: "Non-Listed",
          subcategory: "Participation", currency: "EUR", active: true,
          sort_order: 10, notes: "Admin participation register entry", updated_at: new Date(),
        },
        update: {
          display_name: investee, item_type: "Non-Listed", subcategory: "Participation",
          currency: "EUR", active: true, updated_at: new Date(),
        },
      });
      await tx.non_listed_transactions.create({
        data: {
          transaction_date: new Date(parsedInput.asOfDate),
          tipo: parsedInput.tipo,
          investee,
          currency: "EUR",
          amount: parsedInput.amount,
        },
      });
      await tx.admin_manual_values.create({
        data: {
          as_of_date: new Date(parsedInput.asOfDate),
          item_key: itemKey,
          value: Math.max(0, nextValue),
          currency: "EUR",
          valuation_source: "Admin input",
          valuation_method: `Participation ${parsedInput.tipo}`,
          notes: "",
        },
      });
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

export const savePrivateLoanPrincipal = adminAction
  .schema(privateLoanValuesSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const counterparty = parsedInput.counterparty.trim();
    const itemKey = `TRACKER_LOAN_${slugKey(counterparty)}`;

    const hasDetailedLoans = await prisma.admin_manual_values.findFirst({
      where: { item_key: { startsWith: "TRACKER_LOAN_" } },
      select: { value: true },
    });
    const latest = await prisma.admin_manual_values.findFirst({
      where: { item_key: itemKey },
      orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
      select: { value: true },
    });
    const aggregateFallback = !hasDetailedLoans
      ? await prisma.admin_manual_values.findFirst({
          where: { item_key: "PRIVATE_LOAN_PRINCIPAL" },
          orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
          select: { value: true },
        })
      : null;
    const currentValue = latest?.value ?? aggregateFallback?.value ?? 0;
    const nextValue = parsedInput.tipo === "DISBURSEMENT"
      ? currentValue + parsedInput.amount
      : currentValue - parsedInput.amount;

    if (nextValue < -0.000001) {
      return { error: `Repayment exceeds the current outstanding principal for ${counterparty}.` };
    }

    await prisma.$transaction(async (tx) => {
      await tx.asset_dictionary.upsert({
        where: { item_key: itemKey },
        create: {
          item_key: itemKey, display_name: counterparty, item_type: "Non-Listed",
          subcategory: "Private Loan", currency: "EUR", active: true,
          sort_order: 100, notes: "Admin private loan register entry", updated_at: new Date(),
        },
        update: {
          display_name: counterparty, item_type: "Non-Listed", subcategory: "Private Loan",
          currency: "EUR", active: true, updated_at: new Date(),
        },
      });
      await tx.private_loan_transactions.create({
        data: {
          transaction_date: new Date(parsedInput.asOfDate),
          tipo: parsedInput.tipo,
          counterparty,
          currency: "EUR",
          amount: parsedInput.amount,
        },
      });
      await tx.admin_manual_values.create({
        data: {
          as_of_date: new Date(parsedInput.asOfDate),
          item_key: itemKey,
          value: Math.max(0, nextValue),
          currency: "EUR",
          valuation_source: "Admin input",
          valuation_method: `Private loan ${parsedInput.tipo}`,
          notes: "",
        },
      });
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

const cashOutsideDirectaSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cashOutsideDirecta: z.coerce.number().nonnegative(),
  mode: z.enum(["ADD_TO_BALANCE", "SET_BALANCE"]).default("SET_BALANCE"),
});

export const deleteManualValuesForDate = adminAction
  .schema(z.object({
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    itemKeys: z.array(z.string()).min(1),
  }))
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    await prisma.admin_manual_values.deleteMany({
      where: { as_of_date: new Date(parsedInput.asOfDate), item_key: { in: parsedInput.itemKeys } },
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

export const saveCashOutsideDirecta = adminAction
  .schema(cashOutsideDirectaSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const currentExternalCash = await getCurrentExternalCashBalance();
    const nextExternalCash = parsedInput.mode === "ADD_TO_BALANCE"
      ? currentExternalCash + parsedInput.cashOutsideDirecta
      : parsedInput.cashOutsideDirecta;
    const method = parsedInput.mode === "ADD_TO_BALANCE"
      ? `External cash addition of ${parsedInput.cashOutsideDirecta}`
      : "External cash balance set";
    await prisma.admin_manual_values.create({
      data: {
        as_of_date: new Date(parsedInput.asOfDate),
        item_key: "CASH_OUTSIDE_DIRECTA",
        value: nextExternalCash,
        currency: "EUR",
        valuation_source: "Admin input",
        valuation_method: method,
        notes: "",
      },
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });

export const deleteInvestorProfile = adminAction
  .schema(z.object({ name: z.string() }))
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    await prisma.investor_profiles.update({
      where: { name: parsedInput.name },
      data: { active: false, updated_at: new Date() },
    });
    await syncCurrentApprovedSnapshot();
    return { success: true };
  });
