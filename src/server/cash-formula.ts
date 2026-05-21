import type { CashFormulaBreakdown, PortfolioSnapshot } from "@/types/portfolio";

export const CASH_FORMULA =
  "capitalCollected - listedNetTradeCost + income - participationNetCost - loanNetPrincipal + operatingPnl";

function money(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function metricNumber(metrics: Record<string, number | string>, ...keys: string[]): number {
  for (const key of keys) {
    const value = metrics[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function hasMetric(metrics: Record<string, number | string>, key: string): boolean {
  const value = metrics[key];
  return value !== undefined && value !== null && value !== "";
}

export function buildWorkbookCashFormula(
  metrics: Record<string, number | string>,
  cutoffDate: string
): CashFormulaBreakdown | null {
  if (!hasMetric(metrics, "Listed Net Trade Cost")) return null;

  const capitalCollected = metricNumber(metrics, "Capital Committed", "Capital Collected");
  const listedNetTradeCost = metricNumber(metrics, "Listed Net Trade Cost");
  const income = metricNumber(metrics, "Total Income", "Total Distributions", "Total Income (Div+Cpn+Dist)");
  const baseParticipationNetCost = metricNumber(metrics, "Participation Net Cost");
  const baseLoanNetPrincipal = metricNumber(metrics, "Loan Net Principal", "Loans Outstanding");
  const operatingPnl = metricNumber(metrics, "Operating P&L");

  return recalculateCashFormula(
    {
      source: "CEO tracker workbook",
      formula: CASH_FORMULA,
      baseCutoffDate: cutoffDate,
      capitalCollected,
      listedNetTradeCost,
      income,
      baseParticipationNetCost,
      baseLoanNetPrincipal,
      participationNetCost: baseParticipationNetCost,
      loanNetPrincipal: baseLoanNetPrincipal,
      operatingPnl,
      postCutoffParticipationNetCost: 0,
      postCutoffLoanNetPrincipal: 0,
      cash: metricNumber(metrics, "Total Cash", "Cash", "Cassa EUR"),
    },
    0,
    0
  );
}

export function inferLegacyCashFormulaBase(snapshot: PortfolioSnapshot): CashFormulaBreakdown {
  const capitalCollected = Number(snapshot.overlaySources?.capitalCommitted ?? snapshot.kpis.capitalCommitted ?? 0);
  const income = Number(snapshot.kpis.totalIncome ?? 0);
  const baseCash = Number(snapshot.composition.cash ?? 0);

  return {
    source: "Legacy snapshot inferred from current cash",
    formula: CASH_FORMULA,
    baseCutoffDate: snapshot.cutoffDate,
    capitalCollected,
    listedNetTradeCost: money(capitalCollected + income - baseCash),
    income,
    baseParticipationNetCost: 0,
    baseLoanNetPrincipal: 0,
    participationNetCost: 0,
    loanNetPrincipal: 0,
    operatingPnl: 0,
    postCutoffParticipationNetCost: 0,
    postCutoffLoanNetPrincipal: 0,
    cash: baseCash,
  };
}

export function recalculateCashFormula(
  base: CashFormulaBreakdown,
  postCutoffParticipationNetCost: number,
  postCutoffLoanNetPrincipal: number
): CashFormulaBreakdown {
  const baseParticipationNetCost =
    base.baseParticipationNetCost ?? base.participationNetCost - (base.postCutoffParticipationNetCost ?? 0);
  const baseLoanNetPrincipal =
    base.baseLoanNetPrincipal ?? base.loanNetPrincipal - (base.postCutoffLoanNetPrincipal ?? 0);
  const participationNetCost = baseParticipationNetCost + postCutoffParticipationNetCost;
  const loanNetPrincipal = baseLoanNetPrincipal + postCutoffLoanNetPrincipal;
  const cash = money(
    base.capitalCollected -
      base.listedNetTradeCost +
      base.income -
      participationNetCost -
      loanNetPrincipal +
      base.operatingPnl
  );

  return {
    ...base,
    formula: base.formula || CASH_FORMULA,
    baseParticipationNetCost,
    baseLoanNetPrincipal,
    participationNetCost: money(participationNetCost),
    loanNetPrincipal: money(loanNetPrincipal),
    postCutoffParticipationNetCost: money(postCutoffParticipationNetCost),
    postCutoffLoanNetPrincipal: money(postCutoffLoanNetPrincipal),
    cash,
  };
}
