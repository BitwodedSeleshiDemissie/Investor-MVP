import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadWorkbookFromBuffer } from "../src/lib/excel-loader";
import { importCeoTrackerWorkbook } from "../src/server/services/ceo-tracker-import";

type BaselineConfig = {
  workbook?: string;
  baselineDirectaCash?: number;
};

function readBaselineConfig(): BaselineConfig {
  const configPath = path.resolve(process.cwd(), "bootstrap", "baseline.json");
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as BaselineConfig;
}

function resolveWorkbook(config: BaselineConfig): string {
  const workbookPath =
    process.env.CEO_BASELINE_WORKBOOK ||
    (config.workbook ? path.join("bootstrap", config.workbook) : null) ||
    "bootstrap/Ariete_Capital_Investment_Tracker.xlsx";
  const resolved = path.resolve(process.cwd(), workbookPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `CEO baseline workbook not found at ${resolved}. Set CEO_BASELINE_WORKBOOK or commit the approved workbook under bootstrap/.`
    );
  }
  return resolved;
}

function baselineDirectaCash(config: BaselineConfig): number | null {
  const envValue = process.env.BASELINE_DIRECTA_CASH;
  if (envValue) {
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed)) throw new Error("BASELINE_DIRECTA_CASH must be numeric when set");
    return parsed;
  }
  return typeof config.baselineDirectaCash === "number" ? config.baselineDirectaCash : null;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const config = readBaselineConfig();
  const workbookPath = resolveWorkbook(config);
  const workbookData = loadWorkbookFromBuffer(fs.readFileSync(workbookPath));
  const result = await importCeoTrackerWorkbook({
    workbookData,
    fileName: path.basename(workbookPath),
    approvedBy: "deployment-bootstrap",
    approvalNote: "Automated Prisma deployment bootstrap",
    baselineDirectaCash: baselineDirectaCash(config),
    skipIfSeeded: process.env.BOOTSTRAP_FORCE !== "true",
  });

  console.log(result.skipped ? "CEO baseline already present." : "CEO baseline seeded.");
  console.log(`Snapshot ID: ${result.snapshotId}`);
  console.log(`Cutoff date: ${result.cutoffDate}`);
  console.log(`Total NAV: ${result.portfolioValue.toFixed(2)}`);
  console.log(`Listed: ${result.composition.listed.toFixed(2)}`);
  console.log(`Non-listed: ${result.composition.nonListed.toFixed(2)}`);
  console.log(`Cash: ${result.composition.cash.toFixed(2)}`);
  console.log(`Investors: ${result.investorCount}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
