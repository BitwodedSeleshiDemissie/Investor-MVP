-- CreateTable
CREATE TABLE "fund_settings" (
    "id" BIGSERIAL NOT NULL,
    "setting_key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL DEFAULT 'admin',

    CONSTRAINT "fund_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fund_settings_setting_key_key" ON "fund_settings"("setting_key");

-- Seed defaults. Admins can edit these from the portal after deployment.
INSERT INTO "fund_settings" ("setting_key", "label", "value", "updated_by") VALUES
  ('portfolio_id', 'Portfolio ID', 'AI-0042', 'migration'),
  ('fund_display_name', 'Fund Display Name', 'Investor', 'migration'),
  ('base_currency', 'Base Currency', 'EUR', 'migration'),
  ('subscription_pricing_policy', 'Subscription Pricing Policy', 'NAV/Unit at subscription', 'migration'),
  ('risk_free_rate', 'Risk-Free Rate', '0.035', 'migration'),
  ('moic_target', 'MOIC Target', '2.0', 'migration'),
  ('target_equity_pct', 'Target Equity %', '0.70', 'migration'),
  ('target_bond_pct', 'Target Bond %', '0.20', 'migration'),
  ('target_alt_pct', 'Target Alt %', '0.10', 'migration'),
  ('hurdle_rate', 'Hurdle Rate', '0.05', 'migration'),
  ('gp_carry_pct', 'GP Carry %', '0.20', 'migration'),
  ('catch_up_gp_target_pct', 'Catch-up GP Target %', '0.20', 'migration');
