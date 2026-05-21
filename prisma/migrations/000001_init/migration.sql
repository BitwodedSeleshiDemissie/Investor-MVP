-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "admin_anagrafe_baselines" (
    "id" BIGSERIAL NOT NULL,
    "file_name" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_anagrafe_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_anagrafe_json_store" (
    "store_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_anagrafe_json_store_pkey" PRIMARY KEY ("store_key")
);

-- CreateTable
CREATE TABLE "admin_controls" (
    "id" BIGSERIAL NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "investor_name" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "capital_committed" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_manual_values" (
    "id" BIGSERIAL NOT NULL,
    "as_of_date" DATE NOT NULL,
    "item_key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "valuation_source" TEXT NOT NULL DEFAULT 'Admin input',
    "valuation_method" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_manual_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_dictionary" (
    "item_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_dictionary_pkey" PRIMARY KEY ("item_key")
);

-- CreateTable
CREATE TABLE "directa_csv_files" (
    "id" BIGSERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "month_end" DATE,
    "content" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directa_csv_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_profiles" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "investor_type" TEXT NOT NULL DEFAULT 'Individual',
    "capital_eur" DOUBLE PRECISION NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "subscription_date" DATE NOT NULL,
    "nav_unit_at_sub" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_listed_transactions" (
    "id" BIGSERIAL NOT NULL,
    "transaction_date" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "investee" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_listed_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_snapshot_artifacts" (
    "id" BIGSERIAL NOT NULL,
    "snapshot_id" BIGINT,
    "artifact_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_snapshot_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "as_of_date" DATE NOT NULL,
    "source_file" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publication_status" TEXT NOT NULL DEFAULT 'published',
    "published_at" TIMESTAMPTZ(6),
    "approved_by" TEXT,
    "approval_note" TEXT,
    "overlays_frozen" BOOLEAN NOT NULL DEFAULT false,
    "audit_report" JSONB NOT NULL DEFAULT '{}',
    "deterministic_checks" JSONB NOT NULL DEFAULT '[]',
    "ai_summary" TEXT NOT NULL DEFAULT '',
    "supersedes_snapshot_id" BIGINT,
    "finance_note" TEXT,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_loan_transactions" (
    "id" BIGSERIAL NOT NULL,
    "transaction_date" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_loan_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_tipo_cache" (
    "security_name" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_tipo_cache_pkey" PRIMARY KEY ("security_name")
);

-- AddCheckConstraint
ALTER TABLE "non_listed_transactions" ADD CONSTRAINT "non_listed_transactions_tipo_check" CHECK ("tipo" IN ('BUY', 'SELL'));

-- AddCheckConstraint
ALTER TABLE "private_loan_transactions" ADD CONSTRAINT "private_loan_transactions_tipo_check" CHECK ("tipo" IN ('DISBURSEMENT', 'REPAYMENT'));

-- CreateIndex
CREATE INDEX "idx_admin_anagrafe_uploaded" ON "admin_anagrafe_baselines"("uploaded_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_admin_controls_asof" ON "admin_controls"("as_of_date", "created_at");

-- CreateIndex
CREATE INDEX "idx_admin_manual_values_key_asof" ON "admin_manual_values"("item_key", "as_of_date", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "directa_csv_files_filename_key" ON "directa_csv_files"("filename");

-- CreateIndex
CREATE UNIQUE INDEX "investor_profiles_name_key" ON "investor_profiles"("name");

-- CreateIndex
CREATE INDEX "idx_investor_profiles_active" ON "investor_profiles"("active", "subscription_date");

-- CreateIndex
CREATE INDEX "idx_non_listed_transactions_date" ON "non_listed_transactions"("transaction_date" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_portfolio_snapshot_artifacts_snapshot" ON "portfolio_snapshot_artifacts"("snapshot_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_portfolio_snapshots_asof" ON "portfolio_snapshots"("as_of_date" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_portfolio_snapshots_status_asof" ON "portfolio_snapshots"("publication_status", "as_of_date" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_private_loan_transactions_date" ON "private_loan_transactions"("transaction_date" DESC, "created_at" DESC);

-- AddForeignKey
ALTER TABLE "admin_manual_values" ADD CONSTRAINT "admin_manual_values_item_key_fkey" FOREIGN KEY ("item_key") REFERENCES "asset_dictionary"("item_key") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "portfolio_snapshot_artifacts" ADD CONSTRAINT "portfolio_snapshot_artifacts_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "portfolio_snapshots"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_supersedes_snapshot_id_fkey" FOREIGN KEY ("supersedes_snapshot_id") REFERENCES "portfolio_snapshots"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
