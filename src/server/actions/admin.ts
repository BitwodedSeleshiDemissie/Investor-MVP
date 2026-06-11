"use server";

import { z } from "zod";
import { adminAction } from "@/lib/safe-action";
import { dbEnabled, getPrisma } from "@/db/prisma";
import {
  getFundSettings,
  saveFundSettings as persistFundSettings,
  type FundSettings,
} from "@/server/fund-settings";
import { AGGREGATE_PRIVATE_LOAN_KEY, participationItemKey, privateLoanItemKey } from "@/lib/manual-entry-keys";

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

const cashOutsideDirectaSchema = z.object({
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.coerce.number().nonnegative(),
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
    return { success: true };
  });

export const saveCashOutsideDirecta = adminAction
  .schema(cashOutsideDirectaSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    await prisma.$transaction(async (tx) => {
      await tx.asset_dictionary.upsert({
        where: { item_key: "CASH_OUTSIDE_DIRECTA" },
        create: {
          item_key: "CASH_OUTSIDE_DIRECTA",
          display_name: "Cash Outside Brokerage",
          item_type: "Cash",
          subcategory: "Cash Outside Brokerage",
          currency: "EUR",
          active: true,
          sort_order: 950,
          notes: "Admin-entered outside brokerage cash balance",
          updated_at: new Date(),
        },
        update: {
          display_name: "Cash Outside Brokerage",
          item_type: "Cash",
          subcategory: "Cash Outside Brokerage",
          currency: "EUR",
          active: true,
          sort_order: 950,
          updated_at: new Date(),
        },
      });
      await tx.admin_manual_values.create({
        data: {
          as_of_date: new Date(parsedInput.valueDate),
          item_key: "CASH_OUTSIDE_DIRECTA",
          value: parsedInput.value,
          currency: "EUR",
          valuation_source: "CEO manual input",
          valuation_method: "Monthly outside brokerage cash balance",
          notes: "",
        },
      });
    });
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

export const saveNonListedValues = adminAction
  .schema(nonListedValuesSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const investee = parsedInput.investee.trim();
    const itemKey = participationItemKey(investee);

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
    return { success: true };
  });

export const savePrivateLoanPrincipal = adminAction
  .schema(privateLoanValuesSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    const prisma = getPrisma();
    const counterparty = parsedInput.counterparty.trim();
    const itemKey = privateLoanItemKey(counterparty);

    const hasDetailedLoans = await prisma.admin_manual_values.findFirst({
      where: {
        item_key: { startsWith: "PRIVATE_LOAN_" },
        NOT: { item_key: AGGREGATE_PRIVATE_LOAN_KEY },
      },
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
    return { success: true };
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
    return { success: true };
  });
