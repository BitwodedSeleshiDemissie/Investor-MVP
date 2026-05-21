import { dbEnabled, getPrisma } from "@/db/prisma";

export type CalculationSettings = {
  riskFreeRate: number;
  moicTarget: number;
  targetEquityPct: number;
  targetBondPct: number;
  targetAltPct: number;
};

export type FundSettings = CalculationSettings & {
  portfolioId: string;
  fundDisplayName: string;
  baseCurrency: string;
  subscriptionPricingPolicy: string;
  hurdleRate: number;
  gpCarryPct: number;
  catchUpGpTargetPct: number;
};

type FundSettingKey =
  | "portfolio_id"
  | "fund_display_name"
  | "base_currency"
  | "subscription_pricing_policy"
  | "risk_free_rate"
  | "moic_target"
  | "target_equity_pct"
  | "target_bond_pct"
  | "target_alt_pct"
  | "hurdle_rate"
  | "gp_carry_pct"
  | "catch_up_gp_target_pct";

type FundSettingRow = {
  setting_key: string;
  value: string;
};

type FundSettingWrite = {
  key: FundSettingKey;
  label: string;
  value: string;
};

export const DEFAULT_FUND_SETTINGS: FundSettings = {
  portfolioId: "AI-0042",
  fundDisplayName: "Investor",
  baseCurrency: "EUR",
  subscriptionPricingPolicy: "NAV/Unit at subscription",
  riskFreeRate: 0.035,
  moicTarget: 2.0,
  targetEquityPct: 0.70,
  targetBondPct: 0.20,
  targetAltPct: 0.10,
  hurdleRate: 0.05,
  gpCarryPct: 0.20,
  catchUpGpTargetPct: 0.20,
};

const SETTING_LABELS: Record<FundSettingKey, string> = {
  portfolio_id: "Portfolio ID",
  fund_display_name: "Fund Display Name",
  base_currency: "Base Currency",
  subscription_pricing_policy: "Subscription Pricing Policy",
  risk_free_rate: "Risk-Free Rate",
  moic_target: "MOIC Target",
  target_equity_pct: "Target Equity %",
  target_bond_pct: "Target Bond %",
  target_alt_pct: "Target Alt %",
  hurdle_rate: "Hurdle Rate",
  gp_carry_pct: "GP Carry %",
  catch_up_gp_target_pct: "Catch-up GP Target %",
};

function rowMap(rows: FundSettingRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.setting_key, row.value]));
}

function textSetting(rows: Map<string, string>, key: FundSettingKey, fallback: string): string {
  const value = rows.get(key)?.trim();
  return value ? value : fallback;
}

function numberSetting(rows: Map<string, string>, key: FundSettingKey, fallback: number): number {
  const value = rows.get(key);
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fromRows(rows: FundSettingRow[]): FundSettings {
  const values = rowMap(rows);
  return {
    portfolioId: textSetting(values, "portfolio_id", DEFAULT_FUND_SETTINGS.portfolioId),
    fundDisplayName: textSetting(values, "fund_display_name", DEFAULT_FUND_SETTINGS.fundDisplayName),
    baseCurrency: textSetting(values, "base_currency", DEFAULT_FUND_SETTINGS.baseCurrency).toUpperCase(),
    subscriptionPricingPolicy: textSetting(
      values,
      "subscription_pricing_policy",
      DEFAULT_FUND_SETTINGS.subscriptionPricingPolicy
    ),
    riskFreeRate: numberSetting(values, "risk_free_rate", DEFAULT_FUND_SETTINGS.riskFreeRate),
    moicTarget: numberSetting(values, "moic_target", DEFAULT_FUND_SETTINGS.moicTarget),
    targetEquityPct: numberSetting(values, "target_equity_pct", DEFAULT_FUND_SETTINGS.targetEquityPct),
    targetBondPct: numberSetting(values, "target_bond_pct", DEFAULT_FUND_SETTINGS.targetBondPct),
    targetAltPct: numberSetting(values, "target_alt_pct", DEFAULT_FUND_SETTINGS.targetAltPct),
    hurdleRate: numberSetting(values, "hurdle_rate", DEFAULT_FUND_SETTINGS.hurdleRate),
    gpCarryPct: numberSetting(values, "gp_carry_pct", DEFAULT_FUND_SETTINGS.gpCarryPct),
    catchUpGpTargetPct: numberSetting(
      values,
      "catch_up_gp_target_pct",
      DEFAULT_FUND_SETTINGS.catchUpGpTargetPct
    ),
  };
}

function asWrites(settings: FundSettings): FundSettingWrite[] {
  return [
    { key: "portfolio_id", label: SETTING_LABELS.portfolio_id, value: settings.portfolioId },
    { key: "fund_display_name", label: SETTING_LABELS.fund_display_name, value: settings.fundDisplayName },
    { key: "base_currency", label: SETTING_LABELS.base_currency, value: settings.baseCurrency.toUpperCase() },
    {
      key: "subscription_pricing_policy",
      label: SETTING_LABELS.subscription_pricing_policy,
      value: settings.subscriptionPricingPolicy,
    },
    { key: "risk_free_rate", label: SETTING_LABELS.risk_free_rate, value: String(settings.riskFreeRate) },
    { key: "moic_target", label: SETTING_LABELS.moic_target, value: String(settings.moicTarget) },
    { key: "target_equity_pct", label: SETTING_LABELS.target_equity_pct, value: String(settings.targetEquityPct) },
    { key: "target_bond_pct", label: SETTING_LABELS.target_bond_pct, value: String(settings.targetBondPct) },
    { key: "target_alt_pct", label: SETTING_LABELS.target_alt_pct, value: String(settings.targetAltPct) },
    { key: "hurdle_rate", label: SETTING_LABELS.hurdle_rate, value: String(settings.hurdleRate) },
    { key: "gp_carry_pct", label: SETTING_LABELS.gp_carry_pct, value: String(settings.gpCarryPct) },
    {
      key: "catch_up_gp_target_pct",
      label: SETTING_LABELS.catch_up_gp_target_pct,
      value: String(settings.catchUpGpTargetPct),
    },
  ];
}

export function calculationSettings(settings: FundSettings): CalculationSettings {
  return {
    riskFreeRate: settings.riskFreeRate,
    moicTarget: settings.moicTarget,
    targetEquityPct: settings.targetEquityPct,
    targetBondPct: settings.targetBondPct,
    targetAltPct: settings.targetAltPct,
  };
}

export async function getFundSettings(): Promise<FundSettings> {
  if (!dbEnabled()) return DEFAULT_FUND_SETTINGS;

  const prisma = getPrisma();
  if (!("fund_settings" in prisma)) return DEFAULT_FUND_SETTINGS;

  try {
    const rows = await prisma.fund_settings.findMany({
      select: { setting_key: true, value: true },
    });
    return fromRows(rows);
  } catch {
    return DEFAULT_FUND_SETTINGS;
  }
}

export async function saveFundSettings(settings: FundSettings, updatedBy: string): Promise<void> {
  if (!dbEnabled()) throw new Error("Database not configured");

  const prisma = getPrisma();
  await prisma.$transaction(
    asWrites(settings).map((row) =>
      prisma.fund_settings.upsert({
        where: { setting_key: row.key },
        create: {
          setting_key: row.key,
          label: row.label,
          value: row.value,
          updated_by: updatedBy,
        },
        update: {
          label: row.label,
          value: row.value,
          updated_at: new Date(),
          updated_by: updatedBy,
        },
      })
    )
  );
}
