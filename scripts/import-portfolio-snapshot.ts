import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { loadWorkbook } from "../src/lib/excel-loader";
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
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function ensureSnapshotTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id BIGSERIAL PRIMARY KEY,
      as_of_date DATE NOT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_asof
    ON portfolio_snapshots (as_of_date DESC, created_at DESC)
  `);
}

async function main(): Promise<void> {
  loadDotEnv(path.resolve(process.cwd(), ".env.local"));

  const workbookPath = process.argv[2];
  if (!workbookPath) {
    throw new Error("Usage: npm run import:snapshot -- <path-to-preprocessed-workbook.xlsx>");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const settings = {
    riskFreeRate: envNumber("RISK_FREE_RATE", 0.035),
    moicTarget: envNumber("MOIC_TARGET", 2.0),
    targetEquityPct: envNumber("TARGET_EQUITY_PCT", 0.70),
    targetBondPct: envNumber("TARGET_BOND_PCT", 0.20),
    targetAltPct: envNumber("TARGET_ALT_PCT", 0.10),
  };

  const data = loadWorkbook(workbookPath);
  const cutoffDate = data.cutoffDate.toISOString().split("T")[0];
  const kpis = computeKPIs(data, settings);
  const composition = computeComposition(data);

  const payload: PortfolioSnapshot = {
    kpis,
    timeseries: computeTimeseries(data),
    allocation: computeAllocation(data),
    irr: computeIRR(data),
    risk: computeRisk(data, settings),
    distributions: computeDistributions(data),
    targets: computeTargets(data, settings),
    holdings: computeHoldings(data),
    composition,
    pnl: {
      unrealized: Number(data.portfolioMetrics["Unrealized P&L"] ?? data.portfolioMetrics["Total Unrealized P&L"] ?? 0),
      realized: Number(data.portfolioMetrics["Realized P&L"] ?? data.portfolioMetrics["Total Realized P&L"] ?? 0),
      netTotal: Number(data.portfolioMetrics["Net Total P&L"] ?? data.portfolioMetrics["Net P&L"] ?? 0),
    },
    directaCash: Number(data.portfolioMetrics["Directa Cash"] ?? data.portfolioMetrics["Cash (Directa)"] ?? 0),
    cutoffDate,
    investorName: process.env.INVESTOR_NAME || "Vasco Varo",
    portfolioId: process.env.PORTFOLIO_ID || "AI-0042",
    warnings: checkWarnings(data),
  };

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await ensureSnapshotTable(pool);
    await pool.query(
      `INSERT INTO portfolio_snapshots (as_of_date, source_file, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [cutoffDate, path.basename(workbookPath), JSON.stringify(payload)]
    );
    console.log(`Imported portfolio snapshot ${cutoffDate} from ${workbookPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
