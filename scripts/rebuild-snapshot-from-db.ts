import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import type { PortfolioSnapshot } from "../src/types/portfolio";

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^"|"$/g, "");
    process.env[key] = value;
  }
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  loadDotEnv(path.resolve(process.cwd(), ".env.local"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const { buildWorkbookData, formatDateOnly } = await import("../src/lib/directa-preprocess");
  const {
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
  } = await import("../src/lib/calculations");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const settings = {
      riskFreeRate: envNumber("RISK_FREE_RATE", 0.035),
      moicTarget: envNumber("MOIC_TARGET", 2.0),
      targetEquityPct: envNumber("TARGET_EQUITY_PCT", 0.70),
      targetBondPct: envNumber("TARGET_BOND_PCT", 0.20),
      targetAltPct: envNumber("TARGET_ALT_PCT", 0.10),
    };

    const storedFiles = await pool.query<{ filename: string; content: string }>(
      "SELECT filename, content FROM directa_csv_files ORDER BY month_end ASC NULLS LAST, filename ASC"
    );
    if (storedFiles.rows.length === 0) throw new Error("No stored CSV files found");

    const latestSnapshot = await pool.query<{
      id: string;
      payload: PortfolioSnapshot;
    }>(
      `SELECT id, payload
       FROM portfolio_snapshots
       ORDER BY as_of_date DESC, created_at DESC
       LIMIT 1`
    );
    const previousPayload = latestSnapshot.rows[0]?.payload;

    const cutoffForOverlays = previousPayload?.cutoffDate ?? new Date().toISOString().split("T")[0];
    const nonListedRows = await pool.query<{ value: string }>(
      `SELECT DISTINCT ON (mv.item_key) mv.value
       FROM admin_manual_values mv
       JOIN asset_dictionary d ON d.item_key = mv.item_key
       WHERE d.active = TRUE AND LOWER(d.item_type) <> 'cash' AND mv.as_of_date <= $1
       ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC`,
      [cutoffForOverlays]
    );
    const cashRows = await pool.query<{ value: string }>(
      `SELECT DISTINCT ON (mv.item_key) mv.value
       FROM admin_manual_values mv
       JOIN asset_dictionary d ON d.item_key = mv.item_key
       WHERE d.active = TRUE AND LOWER(d.item_type) = 'cash' AND mv.as_of_date <= $1
       ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC`,
      [cutoffForOverlays]
    );
    const controlRows = await pool.query<{ capital_committed: string; portfolio_id: string; investor_name: string }>(
      `SELECT capital_committed, portfolio_id, investor_name
       FROM admin_controls
       WHERE as_of_date <= $1
       ORDER BY as_of_date DESC, created_at DESC
       LIMIT 1`,
      [cutoffForOverlays]
    );

    const workbook = await buildWorkbookData(
      storedFiles.rows.map((file) => ({ name: file.filename, content: file.content })),
      {
        nonListedValue: nonListedRows.rows.reduce((sum, row) => sum + Number(row.value), 0),
        externalCash: cashRows.rows.reduce((sum, row) => sum + Number(row.value), 0),
        capitalCommitted: Number(controlRows.rows[0]?.capital_committed ?? previousPayload?.kpis.capitalCommitted ?? 0),
      }
    );

    const kpis = computeKPIs(workbook, settings);
    const composition = computeComposition(workbook);
    const cutoffDate = formatDateOnly(workbook.cutoffDate);
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
      directaCash: Number(workbook.portfolioMetrics["Directa Cash"] ?? 0),
      cutoffDate,
      investorName: controlRows.rows[0]?.investor_name || previousPayload?.investorName || process.env.INVESTOR_NAME || "Investor",
      portfolioId: controlRows.rows[0]?.portfolio_id || previousPayload?.portfolioId || process.env.PORTFOLIO_ID || "AI-0042",
      warnings: checkWarnings(workbook),
    };

    await pool.query(
      `INSERT INTO portfolio_snapshots (as_of_date, source_file, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [cutoffDate, "rebuilt from stored CSV history", JSON.stringify(payload)]
    );

    console.log(`Rebuilt snapshot for ${cutoffDate}`);
    console.log(`Annualized return: ${(payload.risk.annualizedReturn * 100).toFixed(2)}%`);
    console.log(`Annualized volatility: ${(payload.risk.volatilityAnnualized * 100).toFixed(2)}%`);
    console.log(`Max drawdown: ${(payload.risk.maxDrawdown * 100).toFixed(2)}%`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
