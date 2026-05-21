/**
 * scripts/check-snapshot-baseline.ts
 *
 * Run before and after snapshot maintenance to verify no numbers changed.
 *
 * Usage against a local app:
 *   npx tsx scripts/check-snapshot-baseline.ts
 *
 * Or against the live server:
 *   BASE_URL=https://your-domain.example ADMIN_SESSION_TOKEN=<cookie> npx tsx scripts/check-snapshot-baseline.ts
 */
import "dotenv/config";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_SESSION_TOKEN = process.env.ADMIN_SESSION_TOKEN ?? "";

async function main() {
  const url = `${BASE_URL}/api/admin/snapshot-baseline`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        cookie: ADMIN_SESSION_TOKEN ? `session=${ADMIN_SESSION_TOKEN}` : "",
      },
    });
  } catch (err) {
    console.error(`\nCould not reach ${url}`);
    console.error("Set BASE_URL to the server address and ADMIN_SESSION_TOKEN to a valid admin session cookie.");
    process.exit(1);
  }

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`\nHTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  const data = await resp.json() as {
    snapshotId: number;
    asOfDate: string;
    cutoffDate: string;
    overlaysFrozen: boolean;
    totalNav: number;
    capitalCommitted: number;
    fundIrr: number | null;
    investorIrr: number | null;
    composition: {
      listed: number;
      nonListed: number;
      cash: number;
      total: number;
    };
    investorPerformance: Array<{
      name: string;
      capitalEur: number;
      currentValueEur: number;
      moic: number;
      irrAnnualized: number;
    }>;
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  const pct = (n: number | null) =>
    n == null ? "n/a" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`SNAPSHOT BASELINE  —  ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Snapshot ID   : ${data.snapshotId}`);
  console.log(`Cutoff date   : ${data.cutoffDate}`);
  console.log(`Frozen        : ${data.overlaysFrozen ? "YES" : "NO  ← needs freeze migration"}`);
  console.log("");
  console.log(`Total NAV     : ${fmt(data.totalNav)}`);
  console.log(`Capital comm. : ${fmt(data.capitalCommitted)}`);
  console.log(`Fund IRR      : ${pct(data.fundIrr)}`);
  console.log(`Investor IRR  : ${pct(data.investorIrr)}`);
  console.log("");
  console.log("Composition:");
  console.log(`  Listed      : ${fmt(data.composition.listed)}`);
  console.log(`  Non-listed  : ${fmt(data.composition.nonListed)}`);
  console.log(`  Cash        : ${fmt(data.composition.cash)}`);
  console.log(`  Total       : ${fmt(data.composition.total)}`);
  console.log("");

  if (data.investorPerformance.length > 0) {
    console.log("Investor performance:");
    const nameW = Math.max(...data.investorPerformance.map((i) => i.name.length), 16);
    const header = `  ${"Name".padEnd(nameW)}  ${"Capital".padStart(14)}  ${"Current value".padStart(14)}  ${"MOIC".padStart(6)}  ${"IRR".padStart(8)}`;
    console.log(header);
    console.log(`  ${"─".repeat(header.length - 2)}`);
    for (const inv of data.investorPerformance) {
      console.log(
        `  ${inv.name.padEnd(nameW)}  ${fmt(inv.capitalEur).padStart(14)}  ${fmt(inv.currentValueEur).padStart(14)}  ${inv.moic.toFixed(3).padStart(6)}  ${pct(inv.irrAnnualized).padStart(8)}`
      );
    }
  } else {
    console.log("Investor performance: (none stored in snapshot)");
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("Save this output. Run again after freeze and diff the two.");
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
