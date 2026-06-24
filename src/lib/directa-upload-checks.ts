import type { PortfolioSnapshot } from "@/types/portfolio";

export type UploadedCsv = {
  name: string;
  content: string;
  statementRows: number;
  positionRows: number;
  hasLendingOrCollateralRows: boolean;
};

export type ReviewCheck = {
  severity: "ok" | "warning" | "blocker";
  title: string;
  detail: string;
};

function isDownloadDuplicateName(filename: string): boolean {
  return /\s\(\d+\)\.csv$/i.test(filename);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildDeterministicChecks(args: {
  uploaded: UploadedCsv[];
  used: UploadedCsv[];
  payload: PortfolioSnapshot;
  previous: PortfolioSnapshot | null;
  externalCash: number;
}): ReviewCheck[] {
  const statementFiles = args.used.filter((file) => file.statementRows > 0);
  const checks: ReviewCheck[] = [];

  checks.push(
    statementFiles.length > 0
      ? {
          severity: "ok",
          title: "Directa statement detected",
          detail: `${statementFiles.length} statement file(s) in the Directa history contain transaction/cash-flow rows.`,
        }
      : {
          severity: "blocker",
          title: "Missing Directa statement",
          detail: "Upload the monthly account/trading statement so cash flows and income can be reconciled.",
        }
  );

  if (args.payload.overlaySources?.brokerageCashSource?.type === "directa_pdf") {
    checks.push({
      severity: "ok",
      title: "Directa PDF snapshot applied",
      detail:
        "Current holdings, listed market value, ISINs, and brokerage account cash come from the Directa PDF snapshot.",
    });
  } else {
    checks.push({
      severity: "blocker",
      title: "Missing Directa PDF snapshot",
      detail:
        "Upload the Directa Situazione Patrimoniale PDF. CSV exports are for transaction history and cannot be the source of current holdings, ISINs, listed value, or brokerage cash.",
    });
  }

  if (args.uploaded.some((file) => isDownloadDuplicateName(file.name))) {
    checks.push({
      severity: "warning",
      title: "Browser download suffix in filename",
      detail:
        "One or more files include a suffix like (1) or (2). The upload canonicalized the filename so the same Directa export is not counted twice.",
    });
  }

  if (args.used.some((file) => file.hasLendingOrCollateralRows)) {
    checks.push({
      severity: "ok",
      title: "Lending/collateral rows handled",
      detail:
        "Directa lending/collateral rows were detected and folded into final holdings where applicable.",
    });
  }

  if (args.externalCash > 0) {
    checks.push({
      severity: "ok",
      title: "Cash outside brokerage confirmed",
      detail: `Cash outside brokerage is ${formatMoney(args.externalCash)}, entered directly by the admin.`,
    });
  }

  if (args.payload.warnings.length > 0) {
    checks.push({
      severity: "warning",
      title: "Calculation warnings present",
      detail: args.payload.warnings.slice(0, 3).join(" | "),
    });
  }

  if (args.previous) {
    const previousTotal = args.previous.kpis.totalPortfolioValue;
    const currentTotal = args.payload.kpis.totalPortfolioValue;
    const delta = currentTotal - previousTotal;
    const deltaPct = previousTotal > 0 ? delta / previousTotal : 0;
    checks.push({
      severity: Math.abs(deltaPct) > 0.2 ? "warning" : "ok",
      title: "Previous snapshot comparison",
      detail: `Total portfolio value changed by ${formatMoney(delta)} (${formatPct(deltaPct)}) versus the previous published snapshot.`,
    });
  }

  if (args.payload.investorPerformance.length === 0) {
    checks.push({
      severity: "blocker",
      title: "No investor profiles configured",
      detail:
        "At least one active investor profile is required to calculate per-investor performance metrics. Add investor profiles via the Investor Profiles admin page, then re-upload.",
    });
  }

  return checks;
}
