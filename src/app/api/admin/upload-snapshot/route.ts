import { NextRequest, NextResponse } from "next/server";
import { query, dbEnabled, getPool } from "@/db/client";
import { initSchema } from "@/db/schema";
import { buildWorkbookData, formatDateOnly } from "@/lib/directa-preprocess";
import { buildAuditWorkbookBuffer } from "@/lib/audit-workbook";
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
} from "@/lib/calculations";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth";
import type { PortfolioSnapshot } from "@/types/portfolio";

const SETTINGS = {
  riskFreeRate: env.RISK_FREE_RATE,
  moicTarget: env.MOIC_TARGET,
  targetEquityPct: env.TARGET_EQUITY_PCT,
  targetBondPct: env.TARGET_BOND_PCT,
  targetAltPct: env.TARGET_ALT_PCT,
};

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

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  await initSchema();

  // Parse multipart form.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const uploadedFiles = formData.getAll("files") as File[];
  if (uploadedFiles.length === 0) {
    return NextResponse.json({ error: "No CSV files uploaded" }, { status: 400 });
  }

  // Store uploaded CSVs in DB (upsert by filename).
  const newFilenames: string[] = [];
  for (const file of uploadedFiles) {
    if (!file.name.endsWith(".csv")) continue;
    const content = await file.text();
    const monthEnd = getMonthEnd(file.name);
    await query(
      `INSERT INTO directa_csv_files (filename, month_end, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (filename) DO UPDATE SET content = EXCLUDED.content, uploaded_at = NOW()`,
      [file.name, monthEnd, content]
    );
    newFilenames.push(file.name);
  }
  if (newFilenames.length === 0) {
    return NextResponse.json({ error: "No valid CSV files found (expected .csv)" }, { status: 400 });
  }

  // Load full CSV history from DB.
  const storedFiles = await query<{ filename: string; content: string }>(
    "SELECT filename, content FROM directa_csv_files ORDER BY month_end ASC NULLS LAST, filename ASC"
  );
  if (storedFiles.length === 0) {
    return NextResponse.json({ error: "No CSV files stored" }, { status: 400 });
  }

  // Read admin overlays from DB.
  // Non-listed: latest value per item_key up to today
  const today = new Date().toISOString().split("T")[0];
  const nonListedRows = await query<{ value: string }>(
    `SELECT DISTINCT ON (mv.item_key) mv.value
     FROM admin_manual_values mv
     JOIN asset_dictionary d ON d.item_key = mv.item_key
     WHERE d.active = TRUE AND LOWER(d.item_type) <> 'cash' AND mv.as_of_date <= $1
     ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC`,
    [today]
  );
  const nonListedValue = nonListedRows.reduce((s, r) => s + Number(r.value), 0);

  const cashRows = await query<{ value: string }>(
    `SELECT DISTINCT ON (mv.item_key) mv.value
     FROM admin_manual_values mv
     JOIN asset_dictionary d ON d.item_key = mv.item_key
     WHERE d.active = TRUE AND LOWER(d.item_type) = 'cash' AND mv.as_of_date <= $1
     ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC`,
    [today]
  );
  const externalCash = cashRows.reduce((s, r) => s + Number(r.value), 0);

  const controlRows = await query<{ capital_committed: string }>(
    "SELECT capital_committed FROM admin_controls ORDER BY as_of_date DESC, created_at DESC LIMIT 1"
  );
  const capitalCommitted = controlRows.length > 0 ? Number(controlRows[0].capital_committed) : 0;

  // Build WorkbookData and compute snapshot.
  let workbook;
  try {
    workbook = await buildWorkbookData(
      storedFiles.map((f) => ({ name: f.filename, content: f.content })),
      { nonListedValue, externalCash, capitalCommitted }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Preprocessing failed: ${msg}` }, { status: 422 });
  }

  const kpis = computeKPIs(workbook, SETTINGS);
  const composition = computeComposition(workbook);

  const payload: PortfolioSnapshot = {
    kpis,
    timeseries: computeTimeseries(workbook),
    allocation: computeAllocation(workbook),
    irr: computeIRR(workbook),
    risk: computeRisk(workbook, SETTINGS),
    distributions: computeDistributions(workbook),
    targets: computeTargets(workbook, SETTINGS),
    holdings: computeHoldings(workbook),
    composition,
    pnl: {
      unrealized: Number(workbook.portfolioMetrics["Unrealized P&L"] ?? 0),
      realized: Number(workbook.portfolioMetrics["Realized P&L"] ?? 0),
      netTotal: Number(workbook.portfolioMetrics["Net Total P&L"] ?? 0),
    },
    directaCash: Number(workbook.portfolioMetrics["Directa Cash"] ?? 0),
    cutoffDate: formatDateOnly(workbook.cutoffDate),
    investorName: env.INVESTOR_NAME,
    portfolioId: env.PORTFOLIO_ID,
    warnings: checkWarnings(workbook),
  };

  // Ensure legacy tables exist (idempotent).
  await query(`
    CREATE TABLE IF NOT EXISTS security_tipo_cache (
      security_name TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id BIGSERIAL PRIMARY KEY,
      as_of_date DATE NOT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const auditFileName = `ariete-directa-audit-${payload.cutoffDate}.xlsx`;
  const auditWorkbook = buildAuditWorkbookBuffer(workbook);
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const client = await pool.connect();
  let snapshotId: number;
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO portfolio_snapshots (as_of_date, source_file, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [payload.cutoffDate, newFilenames.join(", "), JSON.stringify(payload)]
    );
    snapshotId = Number(inserted.rows[0].id);
    await client.query(
      `INSERT INTO portfolio_snapshot_artifacts
         (snapshot_id, artifact_type, file_name, mime_type, content, metadata)
       VALUES ($1, 'preprocessed_workbook', $2, $3, $4, $5::jsonb)`,
      [
        snapshotId,
        auditFileName,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        auditWorkbook,
        JSON.stringify({
          cutoffDate: payload.cutoffDate,
          sourceFiles: newFilenames,
          storedFiles: storedFiles.map((file) => file.filename),
          generatedFrom: "directa_csv_upload",
        }),
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Snapshot save failed: ${msg}` }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    cutoffDate: payload.cutoffDate,
    snapshotId,
    auditFileName,
    filesStored: storedFiles.length,
    newFiles: newFilenames,
    portfolioValue: kpis.totalPortfolioValue,
    directaCash: payload.directaCash,
    holdingsCount: payload.holdings.length,
    warnings: payload.warnings,
  });
}
