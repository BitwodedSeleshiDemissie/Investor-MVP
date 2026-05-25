-- Directa relational ingestion layer.
--
-- The existing directa_csv_files table remains as the raw-file audit store.
-- These tables add row-level Directa source facts used by monthly recalculation.

CREATE TABLE "directa_upload_batches" (
    "id" BIGSERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "canonical_filename" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "month_end" DATE,
    "uploaded_by" TEXT NOT NULL DEFAULT 'admin',
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'imported',
    "transaction_row_count" INTEGER NOT NULL DEFAULT 0,
    "position_row_count" INTEGER NOT NULL DEFAULT 0,
    "has_lending_or_collateral_rows" BOOLEAN NOT NULL DEFAULT false,
    "statement_cash" DOUBLE PRECISION,
    "raw_file_id" BIGINT,

    CONSTRAINT "directa_upload_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "directa_transactions" (
    "id" BIGSERIAL NOT NULL,
    "upload_batch_id" BIGINT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "row_hash" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "file_date" DATE,
    "trade_date" DATE NOT NULL,
    "settlement_date" DATE,
    "security_name" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "transaction_type" TEXT NOT NULL,
    "tipo" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "quantity" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "commission" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directa_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "directa_positions" (
    "id" BIGSERIAL NOT NULL,
    "upload_batch_id" BIGINT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "row_hash" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "file_date" DATE,
    "month_end" DATE,
    "security_name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "market_value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directa_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "directa_cash_balances" (
    "id" BIGSERIAL NOT NULL,
    "upload_batch_id" BIGINT NOT NULL,
    "row_hash" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "month_end" DATE,
    "statement_cash" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directa_cash_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "directa_upload_batches_file_hash_key" ON "directa_upload_batches"("file_hash");
CREATE INDEX "idx_directa_upload_batches_month" ON "directa_upload_batches"("month_end", "uploaded_at");
CREATE INDEX "idx_directa_upload_batches_canonical" ON "directa_upload_batches"("canonical_filename");

CREATE UNIQUE INDEX "directa_transactions_row_hash_key" ON "directa_transactions"("row_hash");
CREATE INDEX "idx_directa_transactions_trade_date" ON "directa_transactions"("trade_date");
CREATE INDEX "idx_directa_transactions_security" ON "directa_transactions"("security_name");
CREATE INDEX "idx_directa_transactions_batch" ON "directa_transactions"("upload_batch_id");

CREATE UNIQUE INDEX "directa_positions_row_hash_key" ON "directa_positions"("row_hash");
CREATE INDEX "idx_directa_positions_month" ON "directa_positions"("month_end");
CREATE INDEX "idx_directa_positions_security" ON "directa_positions"("security_name");
CREATE INDEX "idx_directa_positions_batch" ON "directa_positions"("upload_batch_id");

CREATE UNIQUE INDEX "directa_cash_balances_row_hash_key" ON "directa_cash_balances"("row_hash");
CREATE INDEX "idx_directa_cash_balances_month" ON "directa_cash_balances"("month_end");
CREATE INDEX "idx_directa_cash_balances_batch" ON "directa_cash_balances"("upload_batch_id");

ALTER TABLE "directa_transactions"
  ADD CONSTRAINT "directa_transactions_upload_batch_id_fkey"
  FOREIGN KEY ("upload_batch_id") REFERENCES "directa_upload_batches"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "directa_positions"
  ADD CONSTRAINT "directa_positions_upload_batch_id_fkey"
  FOREIGN KEY ("upload_batch_id") REFERENCES "directa_upload_batches"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "directa_cash_balances"
  ADD CONSTRAINT "directa_cash_balances_upload_batch_id_fkey"
  FOREIGN KEY ("upload_batch_id") REFERENCES "directa_upload_batches"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
