import "dotenv/config";
import { Pool } from "pg";

type PurgeTarget = {
  table: string;
  timestampColumn: string;
};

const targets: PurgeTarget[] = [
  { table: "directa_csv_files", timestampColumn: "uploaded_at" },
  { table: "directa_pdf_files", timestampColumn: "uploaded_at" },
  { table: "portfolio_snapshot_artifacts", timestampColumn: "created_at" },
];

function readRetentionDays(): number {
  const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
  const raw = daysArg?.slice("--days=".length) ?? process.env.SENSITIVE_UPLOAD_RETENTION_DAYS ?? "90";
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("Retention days must be a positive integer");
  }
  return days;
}

function cutoffFor(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const execute = process.argv.includes("--execute");
  const days = readRetentionDays();
  const cutoff = cutoffFor(days);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });

  try {
    console.log(`${execute ? "Purging" : "Dry run for"} raw upload records older than ${cutoff.toISOString()}`);
    for (const target of targets) {
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${target.table} WHERE ${target.timestampColumn} < $1`,
        [cutoff]
      );
      const count = countResult.rows[0]?.count ?? "0";
      if (execute) {
        await pool.query(`DELETE FROM ${target.table} WHERE ${target.timestampColumn} < $1`, [cutoff]);
      }
      console.log(`${target.table}: ${count} row(s) ${execute ? "deleted" : "eligible"}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
