import { NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ items: [] });
  }

  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{
    item_key: string;
    display_name: string;
    item_type: string;
    subcategory: string;
    latest_value: string | null;
    latest_date: string | null;
  }>>`
    WITH has_detailed_participations AS (
      SELECT EXISTS (
        SELECT 1
        FROM admin_manual_values
        WHERE item_key LIKE 'TRACKER_PARTICIPATION_%'
      ) AS yes
    ),
    has_detailed_loans AS (
      SELECT EXISTS (
        SELECT 1
        FROM admin_manual_values
        WHERE item_key LIKE 'TRACKER_LOAN_%'
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
      AND LOWER(d.item_type) <> 'cash'
      AND NOT (
        d.item_key = 'PRIVATE_PARTICIPATIONS'
        AND (SELECT yes FROM has_detailed_participations)
      )
      AND NOT (
        d.item_key = 'PRIVATE_LOAN_PRINCIPAL'
        AND (SELECT yes FROM has_detailed_loans)
      )
    ORDER BY d.sort_order, d.item_key
  `;

  return NextResponse.json({ items: rows });
}
