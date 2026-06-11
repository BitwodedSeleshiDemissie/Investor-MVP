import { dbEnabled, getPrisma } from "@/db/prisma";
import { calculateCashOutsideBrokerage } from "@/lib/cash";
import {
  AGGREGATE_PRIVATE_LOAN_KEY,
  AGGREGATE_PRIVATE_PARTICIPATIONS_KEY,
  CASH_OUTSIDE_DIRECTA_KEY,
  isDetailedParticipationKey,
  isDetailedPrivateLoanKey,
} from "@/lib/manual-entry-keys";
import type {
  AdminDictionaryItem,
  ManualValueRow,
  ControlRow,
  AdminData,
  InvestorProfile,
  PortfolioSnapshot,
} from "@/types/portfolio";

export type SnapshotHistoryRow = {
  id: number;
  cutoffDate: string;
  transactionsThrough: string | null;
  status: "draft" | "published";
  portfolioValue: number;
  holdingsCount: number;
  approvedBy: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  aiSummary: string;
  financeNote: string | null;
  sourceFile: string;
  hasArtifact: boolean;
};

export type AdminFreshness = {
  lastAdminUpdateAt: string | null;
  lastAdminUpdateArea: string | null;
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

function dateTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function getSnapshotHistory(): Promise<SnapshotHistoryRow[]> {
  if (!dbEnabled()) return [];
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{
    id: bigint;
    as_of_date: Date;
    transactions_through: string | null;
    publication_status: string;
    portfolio_value: string | null;
    holdings_count: number | null;
    approved_by: string | null;
    created_at: Date;
    published_at: Date | null;
    ai_summary: string;
    finance_note: string | null;
    source_file: string;
    has_artifact: boolean;
  }>>`
    SELECT
      s.id,
      s.as_of_date,
      COALESCE(
        NULLIF(s.payload -> 'dataFreshness' ->> 'transactionsThrough', ''),
        s.as_of_date::text
      ) AS transactions_through,
      s.publication_status,
      (s.payload -> 'kpis' ->> 'totalPortfolioValue')::numeric AS portfolio_value,
      jsonb_array_length(s.payload -> 'holdings') AS holdings_count,
      s.approved_by,
      s.created_at,
      s.published_at,
      s.ai_summary,
      s.finance_note,
      s.source_file,
      EXISTS (
        SELECT 1 FROM portfolio_snapshot_artifacts a WHERE a.snapshot_id = s.id
      ) AS has_artifact
    FROM portfolio_snapshots s
    WHERE s.as_of_date >= NOW() - INTERVAL '13 months'
    ORDER BY s.as_of_date DESC, s.created_at DESC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    cutoffDate: dateOnly(r.as_of_date),
    transactionsThrough: r.transactions_through ?? null,
    status: r.publication_status === "published" ? "published" : "draft",
    portfolioValue: Number(r.portfolio_value ?? 0),
    holdingsCount: Number(r.holdings_count ?? 0),
    approvedBy: r.approved_by ?? null,
    createdAt: r.created_at ? dateTime(r.created_at) : null,
    publishedAt: r.published_at ? dateTime(r.published_at) : null,
    aiSummary: r.ai_summary ?? "",
    financeNote: r.finance_note ?? null,
    sourceFile: r.source_file ?? "",
    hasArtifact: Boolean(r.has_artifact),
  }));
}

export async function getAdminFreshness(): Promise<AdminFreshness> {
  if (!dbEnabled()) return { lastAdminUpdateAt: null, lastAdminUpdateArea: null };
  const prisma = getPrisma();
  try {
    const rows = await prisma.$queryRaw<Array<{ area: string; updated_at: Date }>>`
      SELECT area, updated_at
      FROM (
        SELECT 'Snapshot upload' AS area, created_at AS updated_at
        FROM portfolio_snapshots
        UNION ALL
        SELECT 'Manual values' AS area, created_at AS updated_at
        FROM admin_manual_values
        UNION ALL
        SELECT 'Controls' AS area, created_at AS updated_at
        FROM admin_controls
        UNION ALL
        SELECT 'Investor profiles' AS area, updated_at AS updated_at
        FROM investor_profiles
        UNION ALL
        SELECT 'Fund settings' AS area, updated_at AS updated_at
        FROM fund_settings
      ) updates
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    return {
      lastAdminUpdateAt: rows[0]?.updated_at ? dateTime(rows[0].updated_at) : null,
      lastAdminUpdateArea: rows[0]?.area ?? null,
    };
  } catch {
    return { lastAdminUpdateAt: null, lastAdminUpdateArea: null };
  }
}

export async function getLatestManualRows(itemType: "non_listed" | "cash"): Promise<ManualValueRow[]> {
  if (!dbEnabled()) return [];
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{
    id: bigint;
    item_key: string;
    display_name: string;
    item_type: string;
    value_date: Date;
    value: string;
    holding_name: string | null;
    created_at: Date;
  }>>`
    SELECT DISTINCT ON (mv.item_key)
        mv.item_key,
        mv.id,
        d.display_name,
        CASE WHEN LOWER(d.item_type) = 'cash' THEN 'cash' ELSE 'non_listed' END AS item_type,
        mv.as_of_date AS value_date,
        mv.value::text AS value,
        NULLIF(mv.notes, '') AS holding_name,
        mv.created_at
      FROM admin_manual_values mv
      JOIN asset_dictionary d ON d.item_key = mv.item_key
      WHERE d.active = TRUE
        AND (
          (${itemType} = 'cash' AND (LOWER(d.item_type) = 'cash' OR mv.item_key ILIKE 'cash%'))
          OR (${itemType} = 'non_listed' AND LOWER(d.item_type) <> 'cash' AND mv.item_key NOT ILIKE 'cash%')
        )
      ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    itemKey: r.item_key,
    displayName: r.display_name,
    itemType: r.item_type as "non_listed" | "cash",
    valueDate: dateOnly(r.value_date),
    value: Number(r.value),
    holdingName: r.holding_name,
    createdAt: dateTime(r.created_at),
  }));
}

export async function getInvestorProfiles(): Promise<InvestorProfile[]> {
  if (!dbEnabled()) return [];
  const prisma = getPrisma();
  const rows = await prisma.investor_profiles.findMany({
    orderBy: [{ subscription_date: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    investorType: r.investor_type,
    capitalEur: r.capital_eur,
    units: r.units,
    subscriptionDate: dateOnly(r.subscription_date),
    navUnitAtSub: r.nav_unit_at_sub,
    active: r.active,
    notes: r.notes,
    createdAt: dateTime(r.created_at),
    updatedAt: dateTime(r.updated_at),
  }));
}

export type FixedPortfolioValues = {
  privateParticipations: number;
  privateLoanPrincipal: number;
  cashOutsideDirecta: number;
  cashOutsideDirectaSource: "manual" | "calculated" | "source_record" | "none";
  statementCash: number;
  history: Array<{
    asOfDate: string;
    privateParticipations: number;
    privateLoanPrincipal: number;
    cashOutsideDirecta: number;
    itemKeys: string[];
  }>;
};

export type NonListedTransactionRow = {
  id: number;
  date: string;
  tipo: "BUY" | "SELL";
  investee: string;
  currency: string;
  amount: number;
};

export type PrivateLoanTransactionRow = {
  id: number;
  date: string;
  tipo: "DISBURSEMENT" | "REPAYMENT";
  counterparty: string;
  currency: string;
  amount: number;
};

function parseSnapshotPayload(value: unknown): PortfolioSnapshot | null {
  if (!value) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as PortfolioSnapshot; } catch { return null; }
  }
  return value as PortfolioSnapshot;
}

function getSourceRecordCashOutsideBrokerage(value: unknown): number {
  const snap = parseSnapshotPayload(value);
  if (!snap) return 0;
  const manualItems = snap.overlaySources?.manualItems ?? [];
  const cashItems = manualItems.filter((item) => {
    const itemType = item.item_type.toLowerCase();
    return (
      itemType === "cash" ||
      item.item_key === CASH_OUTSIDE_DIRECTA_KEY
    );
  });
  const officialCashItems = cashItems.filter((item) => item.item_key === CASH_OUTSIDE_DIRECTA_KEY);
  const selectedCashItems = officialCashItems.length > 0 ? officialCashItems : cashItems;
  if (selectedCashItems.length > 0) return selectedCashItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const externalCash = Number(snap.overlaySources?.externalCash ?? 0);
  if (externalCash > 0) return externalCash;
  const totalCash = Number(snap.composition?.cash ?? 0);
  const statementCash = Number(snap.directaCash ?? 0);
  return Math.max(0, totalCash - statementCash);
}

export async function getFixedPortfolioValues(): Promise<FixedPortfolioValues> {
  const empty: FixedPortfolioValues = {
    privateParticipations: 0, privateLoanPrincipal: 0,
    cashOutsideDirecta: 0, cashOutsideDirectaSource: "none",
    statementCash: 0, history: [],
  };
  if (!dbEnabled()) return empty;
  const prisma = getPrisma();

  const KEYS = [AGGREGATE_PRIVATE_PARTICIPATIONS_KEY, AGGREGATE_PRIVATE_LOAN_KEY, CASH_OUTSIDE_DIRECTA_KEY];

  const [latestRows, historyRows, snapRows, profileCapitalRows, participationLedgerRows, loanLedgerRows, controlRow] = await Promise.all([
    prisma.$queryRaw<Array<{ item_key: string; item_type: string | null; value: string }>>`
      WITH picked AS (
        SELECT DISTINCT ON (mv.item_key)
          mv.item_key,
          mv.value
        FROM admin_manual_values mv
        ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
      )
      SELECT p.item_key, d.item_type, p.value::text AS value
      FROM picked p
      JOIN asset_dictionary d ON d.item_key = p.item_key
      WHERE d.active = TRUE
      ORDER BY d.sort_order, p.item_key
    `,
    prisma.$queryRaw<Array<{ as_of_date: Date; item_key: string; value: string }>>`
      SELECT as_of_date, item_key, value::text AS value
      FROM (
        SELECT DISTINCT ON (as_of_date, item_key)
          as_of_date,
          item_key,
          value
        FROM admin_manual_values
        WHERE item_key = ANY(${KEYS}::text[])
           OR item_key LIKE 'PRIVATE_PARTICIPATION_%'
           OR item_key LIKE 'PRIVATE_LOAN_%'
        ORDER BY as_of_date, item_key, created_at DESC, id DESC
      ) latest_per_date
      ORDER BY as_of_date ASC, item_key ASC
    `,
    prisma.$queryRaw<Array<{ direct_cash: string | null; payload: PortfolioSnapshot }>>`
      SELECT
        (payload ->> 'directaCash')::numeric AS direct_cash,
        payload
      FROM portfolio_snapshots
      WHERE publication_status = 'published'
      ORDER BY as_of_date DESC, created_at DESC
      LIMIT 1
    `,
    prisma.$queryRaw<Array<{ capital_committed: string | null }>>`
      SELECT COALESCE(SUM(capital_eur), 0)::numeric::text AS capital_committed
      FROM investor_profiles
      WHERE active = TRUE
    `,
    prisma.$queryRaw<Array<{ value: string | null; row_count: number }>>`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'SELL' THEN -amount ELSE amount END), 0)::numeric::text AS value,
        COUNT(*)::int AS row_count
      FROM non_listed_transactions
    `,
    prisma.$queryRaw<Array<{ value: string | null; row_count: number }>>`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'REPAYMENT' THEN -amount ELSE amount END), 0)::numeric::text AS value,
        COUNT(*)::int AS row_count
      FROM private_loan_transactions
    `,
    prisma.admin_controls.findFirst({
      orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
      select: { capital_committed: true },
    }),
  ]);

  const byKey = new Map(latestRows.map((r) => [r.item_key, Number(r.value)]));
  const detailedParticipationRows = latestRows.filter((r) => isDetailedParticipationKey(r.item_key));
  const detailedLoanRows = latestRows.filter((r) => isDetailedPrivateLoanKey(r.item_key));
  const detailedParticipations = detailedParticipationRows.reduce((s, r) => s + Number(r.value), 0);
  const detailedLoans = detailedLoanRows.reduce((s, r) => s + Number(r.value), 0);
  const participationLedgerCount = Number(participationLedgerRows[0]?.row_count ?? 0);
  const loanLedgerCount = Number(loanLedgerRows[0]?.row_count ?? 0);
  const participationLedgerValue = Math.max(0, Number(participationLedgerRows[0]?.value ?? 0));
  const loanLedgerValue = Math.max(0, Number(loanLedgerRows[0]?.value ?? 0));
  const ledgerNonListedValue =
    (participationLedgerCount > 0 ? participationLedgerValue : 0) +
    (loanLedgerCount > 0 ? loanLedgerValue : 0);
  const manualNonListedRows = latestRows.filter((row) => {
    const itemType = (row.item_type ?? "").toLowerCase();
    if (itemType) return itemType !== "cash";
    return row.item_key !== CASH_OUTSIDE_DIRECTA_KEY && !row.item_key.includes("CASH");
  });
  const manualCashRows = latestRows.filter((row) => {
    const itemType = (row.item_type ?? "").toLowerCase();
    if (itemType) return itemType === "cash";
    return row.item_key === CASH_OUTSIDE_DIRECTA_KEY || row.item_key.includes("CASH");
  });
  const manualNonListedValue = manualNonListedRows.reduce((sum, row) => sum + Number(row.value), 0);
  const officialCashOutsideRows = manualCashRows.filter((row) => row.item_key === CASH_OUTSIDE_DIRECTA_KEY);
  const cashOutsideRows = officialCashOutsideRows.length > 0 ? officialCashOutsideRows : manualCashRows;
  const manualCashOutside = cashOutsideRows.reduce((sum, row) => sum + Number(row.value), 0);
  const snap = parseSnapshotPayload(snapRows[0]?.payload);
  const statementCash = Number(snapRows[0]?.direct_cash ?? 0);
  const snapshotNonListed = Number(snap?.composition?.nonListed ?? 0);
  const snapshotListed = Number(snap?.composition?.listed ?? 0);
  const effectiveNonListed = participationLedgerCount > 0 || loanLedgerCount > 0
    ? ledgerNonListedValue
    : manualNonListedRows.length > 0 ? manualNonListedValue : snapshotNonListed;
  const profileCapitalCommitted = Number(profileCapitalRows[0]?.capital_committed ?? 0);
  const capitalCommitted = profileCapitalCommitted > 0
    ? profileCapitalCommitted
    : Number(controlRow?.capital_committed ?? snap?.kpis?.capitalCommitted ?? 0);
  const calculatedCashOutside = calculateCashOutsideBrokerage({
    capitalCommitted,
    listedValue: snapshotListed,
    brokerageCash: statementCash,
    nonListedValue: effectiveNonListed,
  });
  const sourceRecordCashOutside = getSourceRecordCashOutsideBrokerage(snapRows[0]?.payload);
  const cashOutsideDirecta = cashOutsideRows.length > 0
    ? manualCashOutside
    : sourceRecordCashOutside > 0
      ? sourceRecordCashOutside
      : calculatedCashOutside;
  const cashOutsideDirectaSource = cashOutsideRows.length > 0
    ? "manual"
    : sourceRecordCashOutside > 0
      ? "source_record"
      : calculatedCashOutside > 0 ? "calculated" : "none";

  const rowsByDate = new Map<string, typeof historyRows>();
  for (const r of historyRows) {
    const d = dateOnly(r.as_of_date);
    rowsByDate.set(d, [...(rowsByDate.get(d) ?? []), r]);
  }

  const balancesByKey = new Map<string, number>();
  const balanceHistory = [...rowsByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asOfDate, rows]) => {
      const itemKeys = new Set<string>();
      for (const row of rows) {
        balancesByKey.set(row.item_key, Number(row.value));
        itemKeys.add(row.item_key);
      }
      const dParticipations = [...balancesByKey.entries()]
        .filter(([key]) => isDetailedParticipationKey(key))
        .reduce((sum, [, v]) => sum + v, 0);
      const dLoans = [...balancesByKey.entries()]
        .filter(([key]) => isDetailedPrivateLoanKey(key))
        .reduce((sum, [, v]) => sum + v, 0);
      return {
        asOfDate,
        privateParticipations: dParticipations > 0 ? dParticipations : balancesByKey.get(AGGREGATE_PRIVATE_PARTICIPATIONS_KEY) ?? 0,
        privateLoanPrincipal: dLoans > 0 ? dLoans : balancesByKey.get(AGGREGATE_PRIVATE_LOAN_KEY) ?? 0,
        cashOutsideDirecta: balancesByKey.get(CASH_OUTSIDE_DIRECTA_KEY) ?? 0,
        itemKeys: [...itemKeys],
      };
    });

  const privateParticipations = participationLedgerCount > 0
    ? participationLedgerValue
    : detailedParticipationRows.length > 0
      ? detailedParticipations
      : byKey.has(AGGREGATE_PRIVATE_PARTICIPATIONS_KEY)
        ? byKey.get(AGGREGATE_PRIVATE_PARTICIPATIONS_KEY) ?? 0
        : manualNonListedRows.length > 0 ? Math.max(0, manualNonListedValue - (byKey.get(AGGREGATE_PRIVATE_LOAN_KEY) ?? detailedLoans)) : snapshotNonListed;
  const privateLoanPrincipal = loanLedgerCount > 0
    ? loanLedgerValue
    : detailedLoanRows.length > 0
      ? detailedLoans
      : byKey.get(AGGREGATE_PRIVATE_LOAN_KEY) ?? 0;

  return {
    privateParticipations,
    privateLoanPrincipal,
    cashOutsideDirecta,
    cashOutsideDirectaSource,
    statementCash: Number(snapRows[0]?.direct_cash ?? 0),
    history: balanceHistory.sort((a, b) => b.asOfDate.localeCompare(a.asOfDate)).slice(0, 24),
  };
}

export async function getNonListedTransactions(): Promise<NonListedTransactionRow[]> {
  if (!dbEnabled()) return [];
  const prisma = getPrisma();
  const rows = await prisma.non_listed_transactions.findMany({
    orderBy: [{ transaction_date: "desc" }, { created_at: "desc" }],
    take: 100,
  });
  return rows.map((r) => ({
    id: Number(r.id),
    date: dateOnly(r.transaction_date),
    tipo: r.tipo === "SELL" ? "SELL" : "BUY",
    investee: r.investee,
    currency: r.currency,
    amount: r.amount,
  }));
}

export async function getPrivateLoanTransactions(): Promise<PrivateLoanTransactionRow[]> {
  if (!dbEnabled()) return [];
  const prisma = getPrisma();
  const rows = await prisma.private_loan_transactions.findMany({
    orderBy: [{ transaction_date: "desc" }, { created_at: "desc" }],
    take: 100,
  });
  return rows.map((r) => ({
    id: Number(r.id),
    date: dateOnly(r.transaction_date),
    tipo: r.tipo === "REPAYMENT" ? "REPAYMENT" : "DISBURSEMENT",
    counterparty: r.counterparty,
    currency: r.currency,
    amount: r.amount,
  }));
}

export async function getAdminData(): Promise<AdminData> {
  if (!dbEnabled()) {
    return { dictionary: [], manualValues: [], controls: [] };
  }
  const prisma = getPrisma();

  const [dictRows, valRows, ctrlRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: number;
      item_key: string;
      display_name: string;
      item_type: string;
      subcategory: string | null;
      currency: string;
      sort_order: number;
    }>>`
      SELECT
        ROW_NUMBER() OVER (ORDER BY sort_order, item_key)::int AS id,
        item_key,
        display_name,
        CASE WHEN LOWER(item_type) = 'cash' THEN 'cash' ELSE 'non_listed' END AS item_type,
        subcategory,
        currency,
        sort_order
      FROM asset_dictionary
      WHERE active = TRUE
      ORDER BY sort_order, display_name
    `,
    prisma.$queryRaw<Array<{
      id: bigint;
      item_key: string;
      display_name: string;
      item_type: string;
      value_date: Date;
      value: string;
      holding_name: string | null;
      created_at: Date;
    }>>`
      SELECT
        mv.id,
        mv.item_key,
        d.display_name,
        CASE WHEN LOWER(d.item_type) = 'cash' THEN 'cash' ELSE 'non_listed' END AS item_type,
        mv.as_of_date AS value_date,
        mv.value::text AS value,
        NULLIF(mv.notes, '') AS holding_name,
        mv.created_at
      FROM admin_manual_values mv
      JOIN asset_dictionary d ON d.item_key = mv.item_key
      ORDER BY mv.as_of_date DESC, mv.id DESC
      LIMIT 200
    `,
    prisma.admin_controls.findMany({
      orderBy: [{ as_of_date: "desc" }],
      take: 50,
    }),
  ]);

  return {
    dictionary: dictRows.map((r) => ({
      id: r.id,
      itemKey: r.item_key,
      displayName: r.display_name,
      itemType: r.item_type as "non_listed" | "cash",
      subcategory: r.subcategory,
      currency: r.currency,
      sortOrder: r.sort_order,
    })),
    manualValues: valRows.map((r) => ({
      id: Number(r.id),
      itemKey: r.item_key,
      displayName: r.display_name,
      itemType: r.item_type as "non_listed" | "cash",
      valueDate: dateOnly(r.value_date),
      value: Number(r.value),
      holdingName: r.holding_name,
      createdAt: dateTime(r.created_at),
    })),
    controls: ctrlRows.map((r) => ({
      id: Number(r.id),
      asOfDate: dateOnly(r.as_of_date),
      capitalCommitted: r.capital_committed,
      createdAt: dateTime(r.created_at),
    })),
  };
}
