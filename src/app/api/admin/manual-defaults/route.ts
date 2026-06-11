import { NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import {
  AGGREGATE_PRIVATE_LOAN_KEY,
  AGGREGATE_PRIVATE_PARTICIPATIONS_KEY,
  CASH_OUTSIDE_DIRECTA_KEY,
  LEGACY_TRACKER_EXTERNAL_CASH_KEY,
  participationItemKey,
  privateLoanItemKey,
} from "@/lib/manual-entry-keys";

type ManualDefaultRow = {
  item_key: string;
  display_name: string;
  item_type: string;
  subcategory: string;
  latest_value: string | null;
  latest_date: string | null;
};

type LedgerDefaultRow = {
  name: string;
  latest_value: string | null;
  latest_date: string | null;
};

function mergeLedgerDefaults(
  rows: ManualDefaultRow[],
  ledgerRows: LedgerDefaultRow[],
  config: {
    keyForName: (name: string) => string;
    subcategory: string;
    sortBeforeKey: string;
  }
): ManualDefaultRow[] {
  const merged = rows.map((row) => ({ ...row }));
  for (const ledger of ledgerRows) {
    const value = Number(ledger.latest_value ?? 0);
    if (value <= 0) continue;
    const itemKey = config.keyForName(ledger.name);
    const existing = merged.find((row) => row.item_key === itemKey);
    if (existing) {
      existing.display_name = ledger.name;
      existing.item_type = "Non-Listed";
      existing.subcategory = config.subcategory;
      existing.latest_value = ledger.latest_value;
      existing.latest_date = ledger.latest_date;
    } else {
      const insertAt = merged.findIndex((row) => row.item_key === config.sortBeforeKey);
      const row = {
        item_key: itemKey,
        display_name: ledger.name,
        item_type: "Non-Listed",
        subcategory: config.subcategory,
        latest_value: ledger.latest_value,
        latest_date: ledger.latest_date,
      };
      if (insertAt === -1) merged.push(row);
      else merged.splice(insertAt, 0, row);
    }
  }
  return merged;
}

function removeLegacyOutsideCashWhenOfficialExists(rows: ManualDefaultRow[]): ManualDefaultRow[] {
  const official = rows.find((row) => row.item_key === CASH_OUTSIDE_DIRECTA_KEY && row.latest_value !== null);
  if (!official) return rows;
  return rows.filter((row) => {
    const subcategory = row.subcategory.toLowerCase();
    return row.item_key !== LEGACY_TRACKER_EXTERNAL_CASH_KEY && !subcategory.includes("outside directa cash");
  });
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ items: [] });
  }

  const prisma = getPrisma();
  const [manualRows, participationLedgerRows, loanLedgerRows] = await Promise.all([
    prisma.$queryRaw<ManualDefaultRow[]>`
    WITH has_detailed_participations AS (
      SELECT EXISTS (
        SELECT 1
        FROM admin_manual_values
        WHERE item_key LIKE 'PRIVATE_PARTICIPATION_%'
      ) AS yes
    ),
    has_detailed_loans AS (
      SELECT EXISTS (
        SELECT 1
        FROM admin_manual_values
        WHERE item_key LIKE 'PRIVATE_LOAN_%'
          AND item_key <> ${AGGREGATE_PRIVATE_LOAN_KEY}
      ) AS yes
    )
    SELECT
      d.item_key,
      d.display_name,
      d.item_type,
      d.subcategory,
      mv.value::text AS latest_value,
      mv.as_of_date::text AS latest_date
    FROM asset_dictionary d
    LEFT JOIN LATERAL (
      SELECT value, as_of_date
      FROM admin_manual_values
      WHERE item_key = d.item_key
      ORDER BY as_of_date DESC, created_at DESC
      LIMIT 1
    ) mv ON TRUE
    WHERE d.active = TRUE
      AND NOT (
        d.item_key = 'PRIVATE_PARTICIPATIONS'
        AND (SELECT yes FROM has_detailed_participations)
      )
      AND NOT (
        d.item_key = ${AGGREGATE_PRIVATE_LOAN_KEY}
        AND (SELECT yes FROM has_detailed_loans)
      )
    ORDER BY d.sort_order, d.item_key
    `,
    prisma.$queryRaw<LedgerDefaultRow[]>`
      SELECT
        investee AS name,
        COALESCE(SUM(CASE WHEN tipo = 'SELL' THEN -amount ELSE amount END), 0)::numeric::text AS latest_value,
        MAX(transaction_date)::text AS latest_date
      FROM non_listed_transactions
      GROUP BY investee
      HAVING COALESCE(SUM(CASE WHEN tipo = 'SELL' THEN -amount ELSE amount END), 0) > 0
      ORDER BY investee
    `,
    prisma.$queryRaw<LedgerDefaultRow[]>`
      SELECT
        counterparty AS name,
        COALESCE(SUM(CASE WHEN tipo = 'REPAYMENT' THEN -amount ELSE amount END), 0)::numeric::text AS latest_value,
        MAX(transaction_date)::text AS latest_date
      FROM private_loan_transactions
      GROUP BY counterparty
      HAVING COALESCE(SUM(CASE WHEN tipo = 'REPAYMENT' THEN -amount ELSE amount END), 0) > 0
      ORDER BY counterparty
    `,
  ]);

  let rows = manualRows;
  if (participationLedgerRows.length > 0) {
    rows = rows.filter((row) => row.item_key !== AGGREGATE_PRIVATE_PARTICIPATIONS_KEY);
    rows = mergeLedgerDefaults(rows, participationLedgerRows, {
      keyForName: participationItemKey,
      subcategory: "Participation",
      sortBeforeKey: AGGREGATE_PRIVATE_LOAN_KEY,
    });
  }
  if (loanLedgerRows.length > 0) {
    rows = rows.filter((row) => row.item_key !== AGGREGATE_PRIVATE_LOAN_KEY);
    rows = mergeLedgerDefaults(rows, loanLedgerRows, {
      keyForName: privateLoanItemKey,
      subcategory: "Private Loan",
      sortBeforeKey: CASH_OUTSIDE_DIRECTA_KEY,
    });
  }
  rows = removeLegacyOutsideCashWhenOfficialExists(rows);

  return NextResponse.json({ items: rows });
}
