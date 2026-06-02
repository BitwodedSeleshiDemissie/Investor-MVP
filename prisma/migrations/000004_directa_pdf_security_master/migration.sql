-- Directa PDF account snapshot ingestion.
--
-- The PDF "Situazione Patrimoniale" is the official end-of-period source for
-- brokerage liquidity, listed positions, listed market value, and ISINs.

CREATE TABLE "directa_pdf_files" (
    "id" BIGSERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "statement_date" DATE,
    "liquidity" DOUBLE PRECISION NOT NULL,
    "listed_total" DOUBLE PRECISION NOT NULL,
    "uploaded_by" TEXT NOT NULL DEFAULT 'admin',
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" BYTEA NOT NULL,

    CONSTRAINT "directa_pdf_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "directa_pdf_positions" (
    "id" BIGSERIAL NOT NULL,
    "pdf_file_id" BIGINT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "row_hash" TEXT NOT NULL,
    "statement_date" DATE,
    "security_name" TEXT NOT NULL,
    "isin" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "market_value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directa_pdf_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_master" (
    "isin" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'Directa PDF',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latest_price" DOUBLE PRECISION,
    "latest_market_value" DOUBLE PRECISION,
    "latest_statement_date" DATE,

    CONSTRAINT "security_master_pkey" PRIMARY KEY ("isin")
);

CREATE UNIQUE INDEX "directa_pdf_files_file_hash_key" ON "directa_pdf_files"("file_hash");
CREATE INDEX "idx_directa_pdf_files_statement_date" ON "directa_pdf_files"("statement_date", "uploaded_at");

CREATE UNIQUE INDEX "directa_pdf_positions_row_hash_key" ON "directa_pdf_positions"("row_hash");
CREATE INDEX "idx_directa_pdf_positions_statement_date" ON "directa_pdf_positions"("statement_date");
CREATE INDEX "idx_directa_pdf_positions_isin" ON "directa_pdf_positions"("isin");
CREATE INDEX "idx_directa_pdf_positions_security" ON "directa_pdf_positions"("security_name");
CREATE INDEX "idx_directa_pdf_positions_file" ON "directa_pdf_positions"("pdf_file_id");

CREATE INDEX "idx_security_master_display_name" ON "security_master"("display_name");
CREATE INDEX "idx_security_master_statement_date" ON "security_master"("latest_statement_date");

ALTER TABLE "directa_pdf_positions"
  ADD CONSTRAINT "directa_pdf_positions_pdf_file_id_fkey"
  FOREIGN KEY ("pdf_file_id") REFERENCES "directa_pdf_files"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

