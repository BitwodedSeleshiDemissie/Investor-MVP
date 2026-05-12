import * as XLSX from "xlsx";
import type { WorkbookData } from "./excel-loader";

function dateCell(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function sheetFromRows(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

function setColumnWidths(sheet: XLSX.WorkSheet, widths: number[]): void {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

export function buildAuditWorkbookBuffer(workbook: WorkbookData): Buffer {
  const audit = XLSX.utils.book_new();

  const metricEntries = Object.entries(workbook.portfolioMetrics).map(([key, value]) => [
    key === "Directa Cash" ? "Statement Cash" : key,
    value,
  ]);
  const metricRows: unknown[][] = [["Metric", "Value", "", "Metric", "Value"]];
  const midpoint = Math.ceil(metricEntries.length / 2);
  for (let i = 0; i < midpoint; i++) {
    const left = metricEntries[i];
    const right = metricEntries[i + midpoint];
    metricRows.push([
      left?.[0] ?? "",
      left?.[1] ?? "",
      "",
      right?.[0] ?? "",
      right?.[1] ?? "",
    ]);
  }
  const metricsSheet = sheetFromRows(metricRows);
  setColumnWidths(metricsSheet, [34, 18, 4, 34, 18]);
  XLSX.utils.book_append_sheet(audit, metricsSheet, "Portfolio Metrics");

  const holdingsRows: unknown[][] = [
    [],
    [],
    ["", "", "", "", "", "", dateCell(workbook.cutoffDate)],
    [],
    [
      "Security",
      "Asset Class",
      "Currency",
      "Shares",
      "Avg Cost",
      "Cost Basis",
      "Current Price",
      "Market Value",
      "Unrealized P&L",
      "P&L %",
      "Weight",
    ],
    ...workbook.holdings.map((h) => [
      h.security,
      h.assetClass,
      h.currency,
      h.shares,
      h.avgCost,
      h.costBasis,
      h.currentPrice,
      h.marketValue,
      h.unrealizedPnl,
      h.pnlPct,
      h.weight,
    ]),
  ];
  const holdingsSheet = sheetFromRows(holdingsRows);
  setColumnWidths(holdingsSheet, [34, 16, 10, 14, 14, 16, 16, 18, 18, 12, 12]);
  XLSX.utils.book_append_sheet(audit, holdingsSheet, "Holdings");

  const tradeRows: unknown[][] = [
    [],
    [],
    [
      "Date",
      "Settlement",
      "Security",
      "Asset Class",
      "Currency",
      "Type",
      "Quantity",
      "Price",
      "Amount (EUR)",
      "Commission",
      "Net Amount",
    ],
    ...workbook.tradeLog.map((t) => [
      dateCell(t.date),
      "",
      t.security,
      t.assetClass,
      t.currency,
      t.type,
      t.shares,
      t.price,
      t.netAmount,
      0,
      t.netAmount,
    ]),
  ];
  const tradeSheet = sheetFromRows(tradeRows);
  setColumnWidths(tradeSheet, [12, 12, 34, 16, 10, 16, 14, 14, 16, 14, 16]);
  XLSX.utils.book_append_sheet(audit, tradeSheet, "Trade Log");

  const irrRows: unknown[][] = [
    ["Investor IRR Cash Flows", "", "", "", "Portfolio IRR Cash Flows"],
    ["Date", "Cash Flow", "", "", "Date", "Cash Flow"],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
  ];
  const maxIrrRows = Math.max(workbook.irrInvestor.length, workbook.irrPortfolio.length);
  for (let i = 0; i < maxIrrRows; i++) {
    const investor = workbook.irrInvestor[i];
    const portfolio = workbook.irrPortfolio[i];
    irrRows.push([
      investor ? dateCell(investor.date) : "",
      investor?.cashFlow ?? "",
      "",
      "",
      portfolio ? dateCell(portfolio.date) : "",
      portfolio?.cashFlow ?? "",
    ]);
  }
  const irrSheet = sheetFromRows(irrRows);
  setColumnWidths(irrSheet, [14, 16, 4, 4, 14, 16]);
  XLSX.utils.book_append_sheet(audit, irrSheet, "IRR Analysis");

  const monthlyRows: unknown[][] = [
    [],
    [],
    [],
    [],
    ["Month End", "Portfolio Value", "Deposits In Month", "Withdrawals In Month", "Monthly Return", "Cumulative Return"],
    ...workbook.monthlyReturns.map((r) => [
      dateCell(r.monthEnd),
      r.nav,
      "",
      "",
      r.monthlyReturn,
      r.cumulativeReturn ?? "",
    ]),
  ];
  const monthlySheet = sheetFromRows(monthlyRows);
  setColumnWidths(monthlySheet, [14, 18, 18, 20, 18, 20]);
  XLSX.utils.book_append_sheet(audit, monthlySheet, "Monthly Returns");

  return Buffer.from(XLSX.write(audit, { type: "buffer", bookType: "xlsx" }) as Buffer);
}
