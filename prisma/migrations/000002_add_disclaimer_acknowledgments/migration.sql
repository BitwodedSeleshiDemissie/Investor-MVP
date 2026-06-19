CREATE TABLE "disclaimer_acknowledgments" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "investor_name" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT 'v1',
    "acknowledged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,

    CONSTRAINT "disclaimer_acknowledgments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "disclaimer_acknowledgments_email_version_key" ON "disclaimer_acknowledgments"("email", "version");

CREATE INDEX "disclaimer_acknowledgments_email_idx" ON "disclaimer_acknowledgments"("email");
