import { query } from "./client";

export async function initSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS asset_dictionary (
      item_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      item_type TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_controls (
      id BIGSERIAL PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      investor_name TEXT NOT NULL,
      as_of_date DATE NOT NULL,
      capital_committed DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_manual_values (
      id BIGSERIAL PRIMARY KEY,
      as_of_date DATE NOT NULL,
      item_key TEXT NOT NULL REFERENCES asset_dictionary(item_key),
      value DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      valuation_source TEXT NOT NULL DEFAULT 'Admin input',
      valuation_method TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_admin_controls_asof
    ON admin_controls (as_of_date, created_at)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_admin_manual_values_key_asof
    ON admin_manual_values (item_key, as_of_date, created_at)
  `);
}
