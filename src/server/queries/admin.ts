import { query, dbEnabled } from "@/db/client";
import type { AdminDictionaryItem, ManualValueRow, ControlRow, AdminData } from "@/types/portfolio";

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

export async function getLatestManualRows(cutoffDate: string, itemType: "non_listed" | "cash"): Promise<ManualValueRow[]> {
  if (!dbEnabled()) return [];
  const rows = await query<{
    id: number; item_key: string; display_name: string; item_type: string; value_date: string;
    value: string; holding_name: string | null; created_at: string;
  }>(
    `SELECT DISTINCT ON (mv.item_key)
        mv.item_key,
        mv.id,
        d.display_name,
        CASE WHEN LOWER(d.item_type) = 'cash' THEN 'cash' ELSE 'non_listed' END AS item_type,
        mv.as_of_date AS value_date,
        mv.value,
        NULLIF(mv.notes, '') AS holding_name,
        mv.created_at
      FROM admin_manual_values mv
      JOIN asset_dictionary d ON d.item_key = mv.item_key
      WHERE mv.as_of_date <= $1
        AND d.active = TRUE
        AND (
          ($2 = 'cash' AND (LOWER(d.item_type) = 'cash' OR mv.item_key ILIKE 'cash%'))
          OR ($2 = 'non_listed' AND LOWER(d.item_type) <> 'cash' AND mv.item_key NOT ILIKE 'cash%')
        )
      ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC`,
    [cutoffDate, itemType]
  );
  return rows.map((r) => ({
    id: r.id,
    itemKey: r.item_key,
    displayName: r.display_name,
    itemType: r.item_type as "non_listed" | "cash",
    valueDate: dateOnly(r.value_date),
    value: Number(r.value),
    holdingName: r.holding_name,
    createdAt: dateTime(r.created_at),
  }));
}

export async function getAdminData(): Promise<AdminData> {
  if (!dbEnabled()) {
    return { dictionary: [], manualValues: [], controls: [] };
  }

  const [dictRows, valRows, ctrlRows] = await Promise.all([
    query<{
      id: number; item_key: string; display_name: string; item_type: string;
      subcategory: string | null; currency: string; sort_order: number;
    }>(`SELECT
          ROW_NUMBER() OVER (ORDER BY sort_order, item_key)::int AS id,
          item_key,
          display_name,
          CASE WHEN LOWER(item_type) = 'cash' THEN 'cash' ELSE 'non_listed' END AS item_type,
          subcategory,
          currency,
          sort_order
        FROM asset_dictionary
        WHERE active = TRUE
        ORDER BY sort_order, display_name`),
    query<{
      id: number; item_key: string; display_name: string; item_type: string; value_date: string;
      value: string; holding_name: string | null; created_at: string;
    }>(`SELECT
          mv.id,
          mv.item_key,
          d.display_name,
          CASE WHEN LOWER(d.item_type) = 'cash' THEN 'cash' ELSE 'non_listed' END AS item_type,
          mv.as_of_date AS value_date,
          mv.value,
          NULLIF(mv.notes, '') AS holding_name,
          mv.created_at
        FROM admin_manual_values mv
        JOIN asset_dictionary d ON d.item_key = mv.item_key
        ORDER BY mv.as_of_date DESC, mv.id DESC
        LIMIT 200`),
    query<{ id: number; as_of_date: string; capital_committed: string; created_at: string }>(
      "SELECT * FROM admin_controls ORDER BY as_of_date DESC LIMIT 50"
    ),
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
      id: r.id,
      itemKey: r.item_key,
      displayName: r.display_name,
      itemType: r.item_type as "non_listed" | "cash",
      valueDate: dateOnly(r.value_date),
      value: Number(r.value),
      holdingName: r.holding_name,
      createdAt: dateTime(r.created_at),
    })),
    controls: ctrlRows.map((r) => ({
      id: r.id,
      asOfDate: dateOnly(r.as_of_date),
      capitalCommitted: Number(r.capital_committed),
      createdAt: dateTime(r.created_at),
    })),
  };
}
