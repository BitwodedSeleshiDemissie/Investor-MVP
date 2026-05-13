import { dbEnabled, query } from "@/db/client";
import type { PortfolioComposition, PortfolioSnapshot } from "@/types/portfolio";

type SnapshotRow = {
  as_of_date: string;
  payload: PortfolioSnapshot;
};

type ManualOverlayRow = {
  item_key: string;
  display_name: string;
  item_type: string;
  value: string;
};

type ControlRow = {
  portfolio_id: string;
  investor_name: string;
  capital_committed: string;
};

function dateOnly(value: string | Date): string {
  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  return value.includes("T") ? value.split("T")[0] : value;
}

function cloneSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as PortfolioSnapshot;
}

async function readLatestSnapshot(): Promise<SnapshotRow | null> {
  const rows = await query<SnapshotRow>(
    `SELECT as_of_date, payload
     FROM portfolio_snapshots
     ORDER BY as_of_date DESC, created_at DESC
     LIMIT 1`
  );
  return rows[0] ?? null;
}

async function readControl(cutoffDate: string): Promise<ControlRow | null> {
  const rows = await query<ControlRow>(
    `SELECT portfolio_id, investor_name, capital_committed
     FROM admin_controls
     WHERE as_of_date <= $1
     ORDER BY as_of_date DESC, created_at DESC
     LIMIT 1`,
    [cutoffDate]
  );
  return rows[0] ?? null;
}

async function readManualOverlays(cutoffDate: string): Promise<ManualOverlayRow[]> {
  return query<ManualOverlayRow>(
    `WITH picked AS (
       SELECT DISTINCT ON (mv.item_key)
         mv.item_key,
         mv.value
       FROM admin_manual_values mv
       WHERE mv.as_of_date <= $1
       ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
     )
     SELECT p.item_key, d.display_name, d.item_type, p.value
     FROM picked p
     JOIN asset_dictionary d ON d.item_key = p.item_key
     WHERE d.active = TRUE
     ORDER BY d.sort_order, d.item_key`,
    [cutoffDate]
  );
}

function applyComposition(snapshot: PortfolioSnapshot, composition: PortfolioComposition): void {
  snapshot.composition = composition;
  snapshot.kpis.totalPortfolioValue = composition.total;
  snapshot.kpis.pctSinceEntry =
    snapshot.kpis.capitalCommitted > 0
      ? (composition.total - snapshot.kpis.capitalCommitted) / snapshot.kpis.capitalCommitted
      : 0;
  snapshot.kpis.moic =
    snapshot.kpis.capitalCommitted > 0
      ? (composition.total + snapshot.kpis.totalIncome) / snapshot.kpis.capitalCommitted
      : 0;
  snapshot.kpis.currentYield = composition.total > 0 ? snapshot.kpis.totalIncome / composition.total : 0;
  snapshot.targets.currentCashPct = composition.total > 0 ? composition.cash / composition.total : 0;
}

async function overlayAdminValues(snapshot: PortfolioSnapshot): Promise<PortfolioSnapshot> {
  const result = cloneSnapshot(snapshot);
  const cutoffDate = result.cutoffDate;
  const [control, manualRows] = await Promise.all([readControl(cutoffDate), readManualOverlays(cutoffDate)]);

  if (control) {
    result.portfolioId = control.portfolio_id || result.portfolioId;
    result.investorName = control.investor_name || result.investorName;
    result.kpis.capitalCommitted = Number(control.capital_committed);
  }

  const nonListed = manualRows
    .filter((row) => row.item_type.toLowerCase() !== "cash")
    .reduce((sum, row) => sum + Number(row.value), 0);
  const cash = manualRows
    .filter((row) => row.item_type.toLowerCase() === "cash")
    .reduce((sum, row) => sum + Number(row.value), 0);

  const composition: PortfolioComposition = {
    listed: result.composition.listed,
    nonListed,
    cash: cash || result.composition.cash,
    total: result.composition.listed + nonListed + (cash || result.composition.cash),
  };

  applyComposition(result, composition);
  result.allocation = result.allocation.map((slice) => {
    if (slice.assetClass.toLowerCase().includes("cash")) {
      return { ...slice, marketValue: composition.cash, weight: composition.total > 0 ? composition.cash / composition.total : 0 };
    }
    return { ...slice, weight: composition.total > 0 ? slice.marketValue / composition.total : 0 };
  });

  if (composition.nonListed > 0 && !result.allocation.some((slice) => slice.assetClass === "Non-Listed")) {
    result.allocation.push({
      assetClass: "Non-Listed",
      marketValue: composition.nonListed,
      weight: composition.total > 0 ? composition.nonListed / composition.total : 0,
    });
  }

  return result;
}

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  if (!dbEnabled()) {
    throw new Error("Database not configured. Set DATABASE_URL to read the portfolio snapshot data.");
  }

  const row = await readLatestSnapshot();
  if (!row) {
    throw new Error("No preprocessed portfolio snapshot found in the database. Import the latest monthly report first.");
  }

  const snapshot = row.payload;
  snapshot.cutoffDate = snapshot.cutoffDate || dateOnly(row.as_of_date);
  return overlayAdminValues(snapshot);
}
