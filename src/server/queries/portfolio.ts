import { dbEnabled, getPrisma } from "@/db/prisma";
import { cleanDisplayName } from "@/lib/auth";
import { calculateCashOutsideBrokerage } from "@/lib/cash";
import { recomputeRiskFromTimeseries } from "@/lib/calculations";
import { resolveIsin } from "@/lib/isin";
import {
  calculationSettings,
  DEFAULT_FUND_SETTINGS,
  getFundSettings,
  type FundSettings,
} from "@/server/fund-settings";
import type { InvestorPerf, NavPoint, PortfolioComposition, PortfolioSnapshot } from "@/types/portfolio";

type SnapshotDbRow = {
  as_of_date: string | Date;
  created_at: string | Date | null;
  source_file: string | null;
  payload: PortfolioSnapshot;
};

type ManualOverlayRow = {
  item_key: string;
  display_name: string;
  item_type: string;
  value: string;
};

type InvestorProfileCalcRow = {
  name: string;
  investor_type: string;
  capital_eur: number;
  units: number;
  subscription_date: Date | string;
  nav_unit_at_sub: number;
};

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

function dateTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function splitSourceFiles(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloneSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as PortfolioSnapshot;
}

function normalizeName(value: string | undefined | null): string {
  return (cleanDisplayName(value) ?? "").toLowerCase();
}

function emptyPortfolioSnapshot(
  investorName?: string,
  warning?: string,
  settings: FundSettings = DEFAULT_FUND_SETTINGS
): PortfolioSnapshot {
  const today = new Date().toISOString().slice(0, 10);
  const calcSettings = calculationSettings(settings);
  return {
    kpis: {
      totalPortfolioValue: 0,
      capitalCommitted: 0,
      pctSinceEntry: 0,
      moic: 0,
      moicTarget: calcSettings.moicTarget,
      currentYield: 0,
      distributionsTotal: 0,
      distributionsCount: 0,
      distributionsLastDate: null,
      totalIncome: 0,
    },
    timeseries: [],
    allocation: [],
    irr: { fundIrr: null, investorIrr: null, valuationDate: today },
    risk: {
      sharpeRatio: 0,
      volatilityAnnualized: 0,
      maxDrawdown: 0,
      annualizedReturn: 0,
      riskFreeRate: calcSettings.riskFreeRate,
      dataWindowMonths: 0,
      betaVsMsciWorld: null,
    },
    distributions: [],
    targets: {
      targetEquityPct: calcSettings.targetEquityPct,
      targetBondPct: calcSettings.targetBondPct,
      targetAltPct: calcSettings.targetAltPct,
      currentEquityPct: 0,
      currentBondPct: 0,
      currentAltPct: 0,
      currentCashPct: 0,
    },
    holdings: [],
    composition: { listed: 0, nonListed: 0, cash: 0, total: 0 },
    pnl: { unrealized: 0, realized: 0, netTotal: 0 },
    directaCash: 0,
    cutoffDate: today,
    investorName: cleanDisplayName(investorName) ?? settings.fundDisplayName,
    portfolioId: settings.portfolioId,
    warnings: [
      warning ??
        "No published portfolio snapshot exists yet. Admin: upload Directa CSVs and the Directa PDF to initialize the portal.",
    ],
    investorPerformance: [],
    dataFreshness: {
      lastUploadAt: null,
      transactionsThrough: today,
      positionsAsOf: today,
      sourceFiles: [],
    },
    sourceRecordReady: true,
    sourceRecordedAt: today,
    overlaySources: {
      capitalCommitted: 0,
      nonListedValue: 0,
      externalCash: 0,
      overlayItemCount: 0,
      investorProfileCount: 0,
      manualItems: [],
    },
  };
}

async function readLatestSnapshot(): Promise<SnapshotDbRow | null> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<SnapshotDbRow[]>`
    SELECT as_of_date, created_at, source_file, payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
    ORDER BY as_of_date DESC, created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function addReadMetadata(snapshot: PortfolioSnapshot, row: SnapshotDbRow): Promise<void> {
  const cutoffDate = snapshot.cutoffDate || dateOnly(row.as_of_date);
  const storedTransactionsThrough = snapshot.dataFreshness?.transactionsThrough ?? null;
  snapshot.cutoffDate = cutoffDate;
  snapshot.dataFreshness = {
    lastUploadAt: snapshot.dataFreshness?.lastUploadAt ?? dateTime(row.created_at),
    transactionsThrough: storedTransactionsThrough ?? cutoffDate,
    positionsAsOf: snapshot.dataFreshness?.positionsAsOf ?? cutoffDate,
    sourceFiles: snapshot.dataFreshness?.sourceFiles?.length
      ? snapshot.dataFreshness.sourceFiles
      : splitSourceFiles(row.source_file),
  };
  snapshot.holdings = (snapshot.holdings ?? []).map((holding) => ({
    ...holding,
    isin: holding.isin || resolveIsin(holding.security),
  }));
}

function snapshotCutoffDate(snapshot: PortfolioSnapshot): Date {
  return new Date(`${snapshot.cutoffDate}T00:00:00`);
}

async function readControl(cutoffDate: string): Promise<{ portfolio_id: string; investor_name: string; capital_committed: string } | null> {
  const prisma = getPrisma();
  const cutoff = new Date(`${cutoffDate}T00:00:00`);
  const row = await prisma.admin_controls.findFirst({
    where: { as_of_date: { lte: cutoff } },
    select: { portfolio_id: true, investor_name: true, capital_committed: true },
    orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
  });
  if (!row) return null;
  return { ...row, capital_committed: String(row.capital_committed) };
}

async function readManualOverlays(cutoffDate: string): Promise<ManualOverlayRow[]> {
  const prisma = getPrisma();
  const cutoff = new Date(`${cutoffDate}T00:00:00`);
  return prisma.$queryRaw<ManualOverlayRow[]>`
    WITH picked AS (
      SELECT DISTINCT ON (mv.item_key)
        mv.item_key,
        mv.value
      FROM admin_manual_values mv
      WHERE mv.as_of_date <= ${cutoff}
      ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
    )
    SELECT p.item_key, d.display_name, d.item_type, p.value::text AS value
    FROM picked p
    JOIN asset_dictionary d ON d.item_key = p.item_key
    WHERE d.active = TRUE
    ORDER BY d.sort_order, d.item_key
  `;
}

function applyComposition(snapshot: PortfolioSnapshot, composition: PortfolioComposition): void {
  snapshot.composition = composition;
  snapshot.kpis.totalPortfolioValue = composition.total;
  snapshot.kpis.pctSinceEntry =
    snapshot.kpis.capitalCommitted > 0
      ? (composition.total - snapshot.kpis.capitalCommitted) / snapshot.kpis.capitalCommitted
      : 0;
  snapshot.kpis.moic =
    snapshot.kpis.capitalCommitted > 0
      ? (composition.total + snapshot.kpis.totalIncome) / snapshot.kpis.capitalCommitted
      : 0;
  snapshot.kpis.currentYield = composition.total > 0 ? snapshot.kpis.totalIncome / composition.total : 0;
  snapshot.targets.currentCashPct = composition.total > 0 ? composition.cash / composition.total : 0;
}

function applyCurrentFundSettings(snapshot: PortfolioSnapshot, settings: FundSettings): void {
  const calcSettings = calculationSettings(settings);
  snapshot.kpis.moicTarget = calcSettings.moicTarget;
  snapshot.targets.targetEquityPct = calcSettings.targetEquityPct;
  snapshot.targets.targetBondPct = calcSettings.targetBondPct;
  snapshot.targets.targetAltPct = calcSettings.targetAltPct;
  snapshot.risk = recomputeRiskFromTimeseries(
    snapshot.timeseries,
    calcSettings.riskFreeRate,
    snapshot.risk.annualizedReturn
  );
}

function roughlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function sourceRecordOwnsInvestorValuation(
  snapshot: PortfolioSnapshot,
  profiles: InvestorProfileCalcRow[],
  manualRows: ManualOverlayRow[]
): boolean {
  const investorPerformance = snapshot.investorPerformance ?? [];
  if (investorPerformance.length === 0) return false;
  if (profiles.length === 0) return true;

  const profileByName = new Map(
    profiles.map((profile) => [normalizeName(profile.name), profile])
  );
  if (profileByName.size !== investorPerformance.length) return false;

  const profilesMatch = investorPerformance.every((investor) => {
    const profile = profileByName.get(normalizeName(investor.name));
    if (!profile) return false;
    return (
      roughlyEqual(Number(profile.capital_eur), investor.capitalEur) &&
      roughlyEqual(Number(profile.units), investor.units) &&
      dateOnly(profile.subscription_date) === investor.subscriptionDate
    );
  });
  if (!profilesMatch) return false;

  const sourceItems = (snapshot.overlaySources?.manualItems ?? [])
    .map((item) => [item.item_key, Number(item.value)] as const);
  const liveItems = manualRows
    .map((item) => [item.item_key, Number(item.value)] as const);
  if (sourceItems.length === 0 || liveItems.length === 0) return true;
  if (sourceItems.length !== liveItems.length) return false;

  const liveByKey = new Map(liveItems);
  return sourceItems.every(([key, value]) => {
    const liveValue = liveByKey.get(key);
    return liveValue !== undefined && roughlyEqual(liveValue, value);
  });
}

function splitProfilesByCutoff(
  profiles: InvestorProfileCalcRow[],
  cutoff: Date
): { cutoffProfiles: InvestorProfileCalcRow[]; postCutoffProfiles: InvestorProfileCalcRow[] } {
  const cutoffDay = dateOnly(cutoff);
  const cutoffProfiles: InvestorProfileCalcRow[] = [];
  const postCutoffProfiles: InvestorProfileCalcRow[] = [];

  for (const profile of profiles) {
    if (dateOnly(profile.subscription_date) <= cutoffDay) {
      cutoffProfiles.push(profile);
    } else {
      postCutoffProfiles.push(profile);
    }
  }

  return { cutoffProfiles, postCutoffProfiles };
}

function appendPostCutoffInvestorProfiles(
  snapshot: PortfolioSnapshot,
  profiles: InvestorProfileCalcRow[]
): void {
  if (profiles.length === 0) return;

  const sourceInvestors = snapshot.investorPerformance ?? [];
  const sourceUnits = sourceInvestors.reduce((sum, p) => sum + p.units, 0);
  const sourceInvestorValue = sourceInvestors.reduce((sum, p) => sum + p.currentValueEur, 0);
  const sourceNavUnit = sourceUnits > 0 ? sourceInvestorValue / sourceUnits : 0;
  const valuationDate = new Date();

  snapshot.investorPerformance = [
    ...sourceInvestors,
    ...profiles.map((p): InvestorPerf => {
      const capitalEur = Number(p.capital_eur);
      const units = Number(p.units);
      const subscriptionDate = dateOnly(p.subscription_date);
      const sub = new Date(subscriptionDate);
      const yearsElapsed = Math.max(
        0,
        (valuationDate.getTime() - sub.getTime()) / (365.25 * 24 * 3600 * 1000)
      );
      const currentValueEur = sourceNavUnit > 0 ? units * sourceNavUnit : capitalEur;
      const moic = capitalEur > 0 ? currentValueEur / capitalEur : 0;
      const irrAnnualized = yearsElapsed > 0 && moic > 0 ? Math.pow(moic, 1 / yearsElapsed) - 1 : 0;

      return {
        name: p.name,
        type: p.investor_type,
        subscriptionDate,
        capitalEur,
        units,
        yearsElapsed,
        navUnitAtSub: Number(p.nav_unit_at_sub),
        currentValueEur,
        moic,
        irrAnnualized,
      };
    }),
  ];
}

async function overlayAdminValues(snapshot: PortfolioSnapshot): Promise<PortfolioSnapshot> {
  const result = cloneSnapshot(snapshot);
  const prisma = getPrisma();
  const cutoff = snapshotCutoffDate(result);
  const [control, manualRows, profileRows] = await Promise.all([
    readControl(result.cutoffDate),
    readManualOverlays(result.cutoffDate),
    prisma.investor_profiles.findMany({
      where: { active: true },
      orderBy: [{ subscription_date: "asc" }, { name: "asc" }],
      select: { name: true, investor_type: true, capital_eur: true, units: true, subscription_date: true, nav_unit_at_sub: true },
    }),
  ]);
  const { cutoffProfiles, postCutoffProfiles } = splitProfilesByCutoff(profileRows, cutoff);
  const keepSourceInvestorValuation = sourceRecordOwnsInvestorValuation(result, cutoffProfiles, manualRows);
  const postCutoffCapital = postCutoffProfiles.reduce((sum, profile) => sum + Number(profile.capital_eur), 0);

  if (control) {
    result.portfolioId = cleanDisplayName(control.portfolio_id) ?? result.portfolioId;
    result.investorName = cleanDisplayName(control.investor_name) ?? result.investorName;
  }
  const profileCapitalCommitted = profileRows.reduce((sum, profile) => sum + Number(profile.capital_eur), 0);
  const hasLiveCapital = profileCapitalCommitted > 0 || Boolean(control);
  result.kpis.capitalCommitted = keepSourceInvestorValuation
    ? result.kpis.capitalCommitted + postCutoffCapital
    : profileCapitalCommitted > 0
      ? profileCapitalCommitted
      : control ? Number(control.capital_committed) : result.kpis.capitalCommitted;

  const nonListedRows = manualRows.filter((row) => row.item_type.toLowerCase() !== "cash");
  const cashRows = manualRows.filter((row) => row.item_type.toLowerCase() === "cash");
  const nonListed = nonListedRows.length > 0
    ? nonListedRows.reduce((sum, row) => sum + Number(row.value), 0)
    : result.composition.nonListed;
  const statementCash = result.directaCash || 0;
  const sourceRecordCashOutsideBrokerage = Number(
    result.overlaySources?.externalCash ?? Math.max(0, Number(result.composition?.cash ?? 0) - statementCash)
  );
  const manualCashOutsideBrokerage = cashRows.reduce((sum, row) => sum + Number(row.value), 0);
  const cashOutsideBrokerage = keepSourceInvestorValuation
    ? (cashRows.length > 0 ? manualCashOutsideBrokerage : sourceRecordCashOutsideBrokerage) + postCutoffCapital
    : cashRows.length > 0
      ? manualCashOutsideBrokerage
      : hasLiveCapital
        ? calculateCashOutsideBrokerage({
            capitalCommitted: result.kpis.capitalCommitted,
            listedValue: result.composition.listed,
            brokerageCash: statementCash,
            nonListedValue: nonListed,
          })
        : sourceRecordCashOutsideBrokerage;
  const cash = statementCash + cashOutsideBrokerage;

  const composition: PortfolioComposition = {
    listed: result.composition.listed,
    nonListed,
    cash,
    total: result.composition.listed + nonListed + cash,
  };

  applyComposition(result, composition);
  if (keepSourceInvestorValuation) {
    appendPostCutoffInvestorProfiles(result, postCutoffProfiles);
  } else {
    applyInvestorProfiles(result, profileRows);
  }
  let hasNonListedAllocation = false;
  result.allocation = result.allocation.map((slice) => {
    const assetClass = slice.assetClass.toLowerCase();
    if (assetClass.includes("cash")) {
      return { ...slice, marketValue: composition.cash, weight: composition.total > 0 ? composition.cash / composition.total : 0 };
    }
    if (assetClass.includes("non-listed") || assetClass.includes("private")) {
      hasNonListedAllocation = true;
      return { ...slice, assetClass: "Non-Listed", marketValue: composition.nonListed, weight: composition.total > 0 ? composition.nonListed / composition.total : 0 };
    }
    return { ...slice, weight: composition.total > 0 ? slice.marketValue / composition.total : 0 };
  });

  if (composition.nonListed > 0 && !hasNonListedAllocation) {
    result.allocation.push({
      assetClass: "Non-Listed",
      marketValue: composition.nonListed,
      weight: composition.total > 0 ? composition.nonListed / composition.total : 0,
    });
  }

  const total = composition.total;
  if (total > 0) {
    const buckets = { equity: 0, bonds: 0, alts: 0, cash: 0 };
    for (const slice of result.allocation) {
      const ac = slice.assetClass.toLowerCase();
      if (ac.includes("cash") || ac.includes("liquid")) buckets.cash += slice.marketValue;
      else if (ac.includes("stock") || ac.includes("equity") || ac.includes("azioni")) buckets.equity += slice.marketValue;
      else if (ac.includes("bond") || ac.includes("fixed") || ac.includes("obblig")) buckets.bonds += slice.marketValue;
      else buckets.alts += slice.marketValue;
    }
    result.targets.currentEquityPct = buckets.equity / total;
    result.targets.currentBondPct   = buckets.bonds   / total;
    result.targets.currentAltPct    = buckets.alts    / total;
    result.targets.currentCashPct   = buckets.cash    / total;
  }

  return result;
}

function applyInvestorProfiles(snapshot: PortfolioSnapshot, profiles: InvestorProfileCalcRow[]): void {
  if (profiles.length === 0) {
    snapshot.investorPerformance = snapshot.investorPerformance ?? [];
    return;
  }

  const totalUnits = profiles.reduce((sum, p) => sum + p.units, 0);
  const navUnit = totalUnits > 0 ? snapshot.kpis.totalPortfolioValue / totalUnits : 0;
  const cutoff = new Date(snapshot.cutoffDate);

  snapshot.investorPerformance = profiles.map((p): InvestorPerf => {
    const capitalEur = p.capital_eur;
    const units = p.units;
    const navUnitAtSub = p.nav_unit_at_sub;
    const subscriptionDate = dateOnly(p.subscription_date);
    const sub = new Date(subscriptionDate);
    const yearsElapsed = Math.max(0, (cutoff.getTime() - sub.getTime()) / (365.25 * 24 * 3600 * 1000));
    const currentValueEur = units * navUnit;
    const moic = capitalEur > 0 ? currentValueEur / capitalEur : 0;
    const irrAnnualized = yearsElapsed > 0 && moic > 0 ? Math.pow(moic, 1 / yearsElapsed) - 1 : 0;

    return {
      name: p.name,
      type: p.investor_type,
      subscriptionDate,
      capitalEur,
      units,
      yearsElapsed,
      navUnitAtSub,
      currentValueEur,
      moic,
      irrAnnualized,
    };
  });
}

function sliceTimeseriesFromDate(timeseries: NavPoint[], fromDate: string): NavPoint[] {
  const idx = timeseries.findIndex((p) => p.monthEnd >= fromDate);
  if (idx <= 0) return timeseries;
  const sliced = timeseries.slice(idx);
  if (sliced.length === 0) return timeseries;
  const baseNav = sliced[0].nav;
  return sliced.map((p, i) => ({
    ...p,
    normalized:       baseNav > 0 ? (p.nav / baseNav) * 100 : 100,
    cumulativeReturn: baseNav > 0 ? (p.nav - baseNav) / baseNav : 0,
    monthlyReturn:    i === 0 ? 0 : p.monthlyReturn,
  }));
}

function applyInvestorPersonalization(snapshot: PortfolioSnapshot, investorName: string): PortfolioSnapshot {
  const requestedName = cleanDisplayName(investorName);
  if (!requestedName) return snapshot;

  const investor = snapshot.investorPerformance?.find(
    (p) => normalizeName(p.name) === normalizeName(requestedName)
  );
  if (!investor) {
    const result = cloneSnapshot(snapshot);
    result.investorName = requestedName;
    result.investorPerformance = [];
    result.kpis = {
      ...result.kpis,
      totalPortfolioValue: 0,
      capitalCommitted: 0,
      pctSinceEntry: 0,
      moic: 0,
      currentYield: 0,
      distributionsTotal: 0,
      distributionsCount: 0,
      distributionsLastDate: null,
      totalIncome: 0,
    };
    result.allocation = [];
    result.holdings = [];
    result.composition = { listed: 0, nonListed: 0, cash: 0, total: 0 };
    result.pnl = { unrealized: 0, realized: 0, netTotal: 0 };
    result.directaCash = 0;
    result.distributions = [];
    result.overlaySources = result.overlaySources
      ? { ...result.overlaySources, capitalCommitted: 0, nonListedValue: 0, externalCash: 0, manualItems: [] }
      : undefined;
    result.warnings = ["No active investor profile is linked to this login."];
    return result;
  }

  const result = cloneSnapshot(snapshot);
  const committed   = investor.capitalEur;
  const currentValue = investor.currentValueEur;

  const fractionOfFund = snapshot.kpis.totalPortfolioValue > 0
    ? currentValue / snapshot.kpis.totalPortfolioValue
    : 0;
  result.pnl = {
    unrealized: result.pnl.unrealized * fractionOfFund,
    realized:   result.pnl.realized   * fractionOfFund,
    netTotal:   result.pnl.netTotal   * fractionOfFund,
  };
  result.composition = {
    listed: result.composition.listed * fractionOfFund,
    nonListed: result.composition.nonListed * fractionOfFund,
    cash: result.composition.cash * fractionOfFund,
    total: currentValue,
  };
  result.directaCash = result.directaCash * fractionOfFund;
  result.allocation = result.allocation.map((slice) => ({
    ...slice,
    marketValue: slice.marketValue * fractionOfFund,
  }));
  result.holdings = result.holdings.map((holding) => ({
    ...holding,
    shares: holding.shares * fractionOfFund,
    costBasis: holding.costBasis * fractionOfFund,
    marketValue: holding.marketValue * fractionOfFund,
    unrealizedPnl: holding.unrealizedPnl * fractionOfFund,
  }));
  result.distributions = result.distributions.map((distribution) => ({
    ...distribution,
    amount: distribution.amount * fractionOfFund,
  }));
  if (result.overlaySources) {
    result.overlaySources = {
      ...result.overlaySources,
      capitalCommitted: committed,
      nonListedValue: result.overlaySources.nonListedValue * fractionOfFund,
      externalCash: result.overlaySources.externalCash * fractionOfFund,
      manualItems: result.overlaySources.manualItems?.map((item) => ({
        ...item,
        value: Number(item.value) * fractionOfFund,
      })),
    };
  }

  result.investorName               = investor.name;
  result.investorPerformance        = [investor];
  result.kpis.totalPortfolioValue   = currentValue;
  result.kpis.capitalCommitted      = committed;
  result.kpis.pctSinceEntry         = committed > 0 ? (currentValue - committed) / committed : 0;
  result.kpis.moic                  = investor.moic;
  result.kpis.totalIncome           = result.kpis.totalIncome * fractionOfFund;
  result.kpis.distributionsTotal    = result.kpis.distributionsTotal * fractionOfFund;
  result.kpis.currentYield          = currentValue > 0 ? result.kpis.totalIncome / currentValue : 0;
  result.irr.investorIrr            = investor.irrAnnualized;
  result.warnings = [];

  const slicedTs = sliceTimeseriesFromDate(result.timeseries, investor.subscriptionDate);
  result.timeseries = slicedTs.map((point) => ({
    ...point,
    nav: point.nav * fractionOfFund,
  }));

  result.risk = recomputeRiskFromTimeseries(
    result.timeseries,
    result.risk.riskFreeRate,
    investor.irrAnnualized
  );

  return result;
}

export async function getPortfolioSnapshot(investorName?: string): Promise<PortfolioSnapshot> {
  if (!dbEnabled()) {
    return emptyPortfolioSnapshot(
      investorName,
      "Database is not configured. Set DATABASE_URL before publishing portfolio data.",
      DEFAULT_FUND_SETTINGS
    );
  }

  const settings = await getFundSettings();
  const row = await readLatestSnapshot();
  if (!row) {
    return emptyPortfolioSnapshot(investorName, undefined, settings);
  }

  const snapshot = row.payload;
  await addReadMetadata(snapshot, row);

  const result = await overlayAdminValues(snapshot);
  result.investorName = cleanDisplayName(result.investorName) ?? "Investor";
  result.portfolioId  = cleanDisplayName(result.portfolioId)  ?? "";
  result.investorPerformance = result.investorPerformance ?? [];

  if (Math.abs(result.risk.volatilityAnnualized) > 5.0 || result.risk.maxDrawdown < -0.5) {
    result.risk = recomputeRiskFromTimeseries(
      result.timeseries,
      result.risk.riskFreeRate,
      result.irr.investorIrr ?? undefined
    );
  }

  applyCurrentFundSettings(result, settings);

  if (investorName) {
    return applyInvestorPersonalization(result, investorName);
  }
  return result;
}
