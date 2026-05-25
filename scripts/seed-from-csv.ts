/**
 * Reads all statement CSV files from a folder, runs the full preprocessing pipeline,
 * and saves the snapshot + audit workbook to the database.
 *
 * Usage: npx tsx scripts/seed-from-csv.ts <folder-path>
 * Example: npx tsx scripts/seed-from-csv.ts "C:\Users\bitwo\OneDrive\Desktop\Ariete preprocessing\preprocessing\files"
 */
import fs from "node:fs";
import path from "node:path";
import { Pool, PoolClient } from "pg";
import { buildWorkbookData, formatDateOnly } from "../src/lib/directa-preprocess";
import { buildAuditWorkbookBuffer } from "../src/lib/audit-workbook";
import {
  checkWarnings,
  computeAllocation,
  computeComposition,
  computeDistributions,
  computeHoldings,
  computeIRR,
  computeKPIs,
  computeRisk,
  computeTargets,
  computeTimeseries,
} from "../src/lib/calculations";
import type { PortfolioSnapshot } from "../src/types/portfolio";

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2];
  }
}

function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getMonthEnd(filename: string): string | null {
  const m1 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = filename.match(/Ec30_(\d{1,2})_(\d{4})/i);
  if (m2) {
    const month = parseInt(m2[1], 10);
    const year = parseInt(m2[2], 10);
    const last = new Date(year, month, 0);
    return `${year}-${String(month).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  }
  return null;
}

async function ensureSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS directa_csv_files (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      month_end DATE,
      content TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS security_tipo_cache (
      security_name TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id BIGSERIAL PRIMARY KEY,
      as_of_date DATE NOT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshot_artifacts (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id BIGINT REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content BYTEA NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
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
  await client.query(`
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
  await client.query(`
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_anagrafe_baselines (
      id BIGSERIAL PRIMARY KEY,
      file_name TEXT NOT NULL,
      content BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_anagrafe_json_store (
      store_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function main(): Promise<void> {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const folderArg = process.argv[2] ?? "C:\\Users\\bitwo\\OneDrive\\Desktop\\Ariete preprocessing\\preprocessing\\files";
  const folder = path.resolve(folderArg);

  if (!fs.existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");

  const csvFiles = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith(".csv"))
    .sort();

  if (csvFiles.length === 0) throw new Error(`No .csv files found in ${folder}`);

  console.log(`Found ${csvFiles.length} CSV files:`);
  csvFiles.forEach((f) => console.log(`  ${f}`));

  const settings = {
    riskFreeRate: envNumber("RISK_FREE_RATE", 0.035),
    moicTarget: envNumber("MOIC_TARGET", 2.0),
    targetEquityPct: envNumber("TARGET_EQUITY_PCT", 0.70),
    targetBondPct: envNumber("TARGET_BOND_PCT", 0.20),
    targetAltPct: envNumber("TARGET_ALT_PCT", 0.10),
  };
  // Admin overlays — zero for a fresh seed; set via admin UI afterwards
  const overlays = { nonListedValue: 0, externalCash: 0, capitalCommitted: 0 };

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    console.log("\nCreating schema...");
    await ensureSchema(client);

    console.log("\nStoring CSV files...");
    const fileObjects: { name: string; content: string }[] = [];
    for (const filename of csvFiles) {
      const content = fs.readFileSync(path.join(folder, filename), "utf8");
      const monthEnd = getMonthEnd(filename);
      await client.query(
        `INSERT INTO directa_csv_files (filename, month_end, content)
         VALUES ($1, $2, $3)
         ON CONFLICT (filename) DO UPDATE SET content = EXCLUDED.content, uploaded_at = NOW()`,
        [filename, monthEnd, content]
      );
      fileObjects.push({ name: filename, content });
      console.log(`  stored: ${filename}`);
    }

    console.log("\nRunning preprocessing pipeline...");
    const workbook = await buildWorkbookData(fileObjects, overlays);
    console.log(`  cutoff date: ${formatDateOnly(workbook.cutoffDate)}`);
    console.log(`  holdings: ${workbook.holdings.length}`);
    console.log(`  trade rows: ${workbook.tradeLog.length}`);
    console.log(`  monthly returns: ${workbook.monthlyReturns.length}`);

    const kpis = computeKPIs(workbook, settings);
    const composition = computeComposition(workbook);

    const payload: PortfolioSnapshot = {
      kpis,
      timeseries: computeTimeseries(workbook),
      allocation: computeAllocation(workbook),
      irr: computeIRR(workbook),
      risk: computeRisk(workbook, settings),
      distributions: computeDistributions(workbook),
      targets: computeTargets(workbook, settings),
      holdings: computeHoldings(workbook),
      composition,
      pnl: {
        unrealized: Number(workbook.portfolioMetrics["Unrealized P&L"] ?? 0),
        realized: Number(workbook.portfolioMetrics["Realized P&L"] ?? 0),
        netTotal: Number(workbook.portfolioMetrics["Net Total P&L"] ?? 0),
      },
      directaCash: Number(workbook.portfolioMetrics["Statement Cash"] ?? workbook.portfolioMetrics["Directa Cash"] ?? 0),
      cutoffDate: formatDateOnly(workbook.cutoffDate),
      investorName: process.env.INVESTOR_NAME ?? "Investor",
      portfolioId: process.env.PORTFOLIO_ID ?? "AI-0042",
      warnings: checkWarnings(workbook),
      investorPerformance: [],
    };

    console.log(`\n  total portfolio value: €${kpis.totalPortfolioValue.toLocaleString("it-IT", { maximumFractionDigits: 0 })}`);
    if (payload.warnings.length > 0) {
      console.log(`  warnings: ${payload.warnings.join(", ")}`);
    }

    const auditFileName = `ariete-statement-audit-${payload.cutoffDate}.xlsx`;
    const auditBuffer = buildAuditWorkbookBuffer(workbook);

    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO portfolio_snapshots (as_of_date, source_file, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [payload.cutoffDate, csvFiles.join(", "), JSON.stringify(payload)]
    );
    const snapshotId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO portfolio_snapshot_artifacts
         (snapshot_id, artifact_type, file_name, mime_type, content, metadata)
       VALUES ($1, 'preprocessed_workbook', $2, $3, $4, $5::jsonb)`,
      [
        snapshotId,
        auditFileName,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        auditBuffer,
        JSON.stringify({ cutoffDate: payload.cutoffDate, sourceFiles: csvFiles }),
      ]
    );
    await client.query("COMMIT");

    console.log(`\nSnapshot saved (id=${snapshotId}, cutoff=${payload.cutoffDate})`);
    console.log(`Audit workbook: ${auditFileName}`);
    console.log("\nDone. Start the dev server and check the portal.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
