"use server";

import { z } from "zod";
import { adminAction } from "@/lib/safe-action";
import { query, dbEnabled } from "@/db/client";
import { initSchema } from "@/db/schema";
import { env } from "@/lib/env";

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

export const saveDictionaryItem = adminAction
  .schema(dictionarySchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    await initSchema();
    await query(
      `INSERT INTO asset_dictionary (item_key, display_name, item_type, subcategory, currency, active, sort_order, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, '', NOW())
       ON CONFLICT (item_key) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         item_type = EXCLUDED.item_type,
         subcategory = EXCLUDED.subcategory,
         currency = EXCLUDED.currency,
         active = TRUE,
         sort_order = EXCLUDED.sort_order,
         updated_at = NOW()`,
      [
        parsedInput.itemKey,
        parsedInput.displayName,
        parsedInput.itemType === "cash" ? "Cash" : "Non-Listed",
        parsedInput.subcategory ?? "",
        parsedInput.currency,
        parsedInput.sortOrder,
      ]
    );
    return { success: true };
  });

export const saveManualValue = adminAction
  .schema(manualValueSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    await initSchema();
    const dictionary = await query<{ item_type: string }>(
      `SELECT item_type FROM asset_dictionary WHERE item_key = $1 LIMIT 1`,
      [parsedInput.itemKey]
    );
    const itemType = dictionary[0]?.item_type?.toLowerCase() ?? "";
    const valuationMethod = itemType === "cash" ? "Monthly cash value" : "Monthly approved value";

    await query(
      `INSERT INTO admin_manual_values (as_of_date, item_key, value, currency, valuation_source, valuation_method, notes)
       VALUES ($1, $2, $3, 'EUR', 'Admin input', $4, $5)`,
      [
        parsedInput.valueDate,
        parsedInput.itemKey,
        parsedInput.value,
        valuationMethod,
        parsedInput.holdingName ?? "",
      ]
    );
    return { success: true };
  });

export const saveControl = adminAction
  .schema(controlSchema)
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    await initSchema();
    await query(
      `INSERT INTO admin_controls (portfolio_id, investor_name, as_of_date, capital_committed, currency, notes)
       VALUES ($1, $2, $3, $4, 'EUR', 'Admin-entered official capital commitment')`,
      [env.PORTFOLIO_ID, env.INVESTOR_NAME, parsedInput.asOfDate, parsedInput.capitalCommitted]
    );
    return { success: true };
  });

export const deleteDictionaryItem = adminAction
  .schema(z.object({ itemKey: z.string() }))
  .action(async ({ parsedInput }) => {
    if (!dbEnabled()) return { error: "Database not configured" };
    await query(`UPDATE asset_dictionary SET active = FALSE, updated_at = NOW() WHERE item_key = $1`, [parsedInput.itemKey]);
    return { success: true };
  });
