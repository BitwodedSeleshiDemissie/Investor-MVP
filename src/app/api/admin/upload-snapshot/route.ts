import { NextRequest, NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import {
  buildWorkbookDataFromParsedRows,
  formatDateOnly,
  parseCsvFile,
  parsePositionCsvFile,
} from "@/lib/directa-preprocess";
import type { DirectaLiquidityPdf } from "@/lib/directa-pdf";
import { calculateCashOutsideBrokerage } from "@/lib/cash";
import type { HoldingRow, WorkbookData } from "@/lib/workbook-data";
import {
  buildDeterministicChecks,
  type ReviewCheck,
  type UploadedCsv,
} from "@/lib/directa-upload-checks";
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
  xirrSafe,
} from "@/lib/calculations";
import { getSession } from "@/lib/auth";
import { calculationSettings, getFundSettings } from "@/server/fund-settings";
import {
  buildDirectaSourceData,
  monthEndFromFilename,
  syncDirectaCsvFile,
  type DirectaSyncResult,
} from "@/server/directa-ingestion";
import { syncDirectaPdfFile } from "@/server/directa-pdf-ingestion";
import type { InvestorPerf, PortfolioSnapshot } from "@/types/portfolio";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

function dbDateOnly(value: string | Date): string {
  if (value instanceof Date) return formatDateOnly(value);
  return String(value).split("T")[0];
}

function classifyUploadedCsv(name: string, content: string): UploadedCsv {
  const statementRows = parseCsvFile(content, name).length;
  const positionRows = parsePositionCsvFile(content, name).filter((row) => row.quantity > 0 && row.marketValue > 0).length;
  return {
    name,
    content,
    statementRows,
    positionRows,
    hasLendingOrCollateralRows: /fondi a garanzia|titoli prestati|titoli resi|totale/i.test(content),
  };
}

function computeFundIrrFromProfiles(
  profiles: Array<{ capital_eur: number; subscription_date: Date | string }>,
  cutoffDate: string,
  currentNav: number
): number | null {
  if (currentNav <= 0 || profiles.length === 0) return null;
  const cashflows = profiles
    .map((profile) => {
      const rawDate = dbDateOnly(profile.subscription_date);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00Z`) : new Date(rawDate);
      return { date, amount: -Number(profile.capital_eur) };
    })
    .filter((cf) => Number.isFinite(cf.amount) && cf.amount < 0 && Number.isFinite(cf.date.getTime()));
  if (cashflows.length === 0) return null;
  cashflows.sort((a, b) => a.date.getTime() - b.date.getTime());
  cashflows.push({ date: new Date(`${cutoffDate}T00:00:00Z`), amount: currentNav });
  return xirrSafe(cashflows);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function previousDirectaCashForComparison(snapshot: PortfolioSnapshot | null): number | null {
  if (!snapshot) return null;
  return snapshot.directaCash ?? null;
}

function latestLiquidityPdf(pdfs: DirectaLiquidityPdf[]): DirectaLiquidityPdf | null {
  if (pdfs.length === 0) return null;
  return [...pdfs].sort((a, b) => (b.statementDate ?? "").localeCompare(a.statementDate ?? ""))[0];
}

function normalizeSecurityName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inferPdfAssetClass(security: string): string {
  const label = security.toLowerCase();
  if (label.includes("bond") || label.includes("btp") || label.includes("%") || label.includes("fx ")) return "Bonds";
  if (label.includes("etf") || label.includes("ucits") || label.includes("ishares") || label.includes("wisdomtree") || label.includes("vaneck") || label.includes("bitwise")) return "ETF";
  return "Stocks";
}

function applyPdfListedPositions(workbook: WorkbookData, pdf: DirectaLiquidityPdf): void {
  const byIsin = new Map(workbook.holdings.filter((h) => h.isin).map((h) => [h.isin, h]));
  const byName = new Map(workbook.holdings.map((h) => [normalizeSecurityName(h.security), h]));
  const listedTotal = pdf.listedTotal || pdf.positions.reduce((sum, position) => sum + position.marketValue, 0);

  workbook.holdings = pdf.positions.map((position): HoldingRow => {
    const prior = byIsin.get(position.isin) ?? byName.get(normalizeSecurityName(position.security));
    const costBasis = prior?.costBasis ?? position.marketValue;
    const unrealizedPnl = position.marketValue - costBasis;
    return {
      security: position.security,
      isin: position.isin,
      assetClass: prior?.assetClass ?? inferPdfAssetClass(position.security),
      currency: "EUR",
      shares: position.quantity,
      avgCost: position.quantity > 0 ? costBasis / position.quantity : position.price,
      costBasis,
      currentPrice: position.price,
      marketValue: position.marketValue,
      unrealizedPnl,
      pnlPct: costBasis > 0 ? unrealizedPnl / costBasis : 0,
      weight: listedTotal > 0 ? position.marketValue / listedTotal : 0,
    };
  });
}

function setWorkbookCashMetrics(args: {
  workbook: WorkbookData;
  listedValue: number;
  brokerageCash: number;
  cashOutsideBrokerage: number;
  nonListedValue: number;
}): void {
  const totalCash = args.brokerageCash + args.cashOutsideBrokerage;
  const totalPortfolioValue = args.listedValue + args.nonListedValue + totalCash;
  args.workbook.portfolioMetrics["Listed Market Value"] = args.listedValue;
  args.workbook.portfolioMetrics["Total Market Value (Holdings)"] = args.listedValue;
  args.workbook.portfolioMetrics["Statement Cash"] = args.brokerageCash;
  args.workbook.portfolioMetrics["Directa Cash"] = args.brokerageCash;
  args.workbook.portfolioMetrics["External Cash"] = args.cashOutsideBrokerage;
  args.workbook.portfolioMetrics["Cash Outside Brokerage"] = args.cashOutsideBrokerage;
  args.workbook.portfolioMetrics["Total Cash"] = totalCash;
  args.workbook.portfolioMetrics["Total Portfolio Value"] = totalPortfolioValue;
}

function buildReviewSummary(args: {
  uploaded: UploadedCsv[];
  payload: PortfolioSnapshot;
  previous: PortfolioSnapshot | null;
  externalCash: number;
}): string {
  const statementFiles = args.uploaded.filter((file) => file.statementRows > 0).length;
  const valuationText = "Listed market value, quantities, and ISINs are based on the Directa PDF account snapshot.";
  const previousTotal = args.previous?.kpis.totalPortfolioValue ?? null;
  const deltaText = previousTotal && previousTotal > 0
    ? ` Portfolio value changed by ${formatMoney(args.payload.kpis.totalPortfolioValue - previousTotal)} versus the previous published snapshot.`
    : "";
  const overlayText = args.externalCash > 0
    ? ` Cash outside brokerage was calculated as the residual after capital committed, brokerage value, and non-listed investments.`
    : "";
  const lendingText = args.uploaded.some((file) => file.hasLendingOrCollateralRows)
    ? ` Directa lending/collateral rows were detected and folded into final positions where applicable.`
    : "";
  return [
    `The upload produced a draft snapshot for ${args.payload.cutoffDate} using ${statementFiles} Directa CSV statement file(s) and the Directa PDF account snapshot.`,
    `${valuationText} Brokerage account cash is ${formatMoney(args.payload.directaCash)}.`,
    `${args.payload.holdings.length} listed holdings were parsed, with total portfolio value ${formatMoney(args.payload.kpis.totalPortfolioValue)}.${deltaText}`,
    `${lendingText}${overlayText}`.trim(),
    "If these figures do not match finance records, do not publish; correct the source files or contact the dev team.",
  ].filter(Boolean).join(" ");
}

async function buildAiReviewSummary(args: {
  uploaded: UploadedCsv[];
  payload: PortfolioSnapshot;
  previous: PortfolioSnapshot | null;
  externalCash: number;
  checks: ReviewCheck[];
}): Promise<{ summary: string; provider: "openai" | "rules" }> {
  const fallback = buildReviewSummary(args);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { summary: fallback, provider: "rules" };

  const model = process.env.OPENAI_AUDIT_MODEL || "gpt-4o-mini";
  const checkSummary = args.checks.map((check) => `${check.severity}: ${check.title} - ${check.detail}`).join("\n");
  const previousTotal = args.previous?.kpis.totalPortfolioValue ?? null;
  const previousCash = previousDirectaCashForComparison(args.previous);
  const previousHoldings = args.previous?.holdings?.length ?? null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content: `You are a fund operations analyst reviewing a monthly Directa upload package before it is published to investors.
Answer each of the 5 questions below with exactly one bullet point. Use only the data provided — do not invent numbers or speculate beyond the facts.
Be factual and specific. Total output must be under 180 words.

Questions to answer:
1. Positions & trades: Do the quantities and holdings count look coherent with the Estratto Conto trade history and Directa PDF account snapshot?
2. Cash: Does the brokerage account cash figure from the Directa liquidity PDF make sense?
3. Month-on-month change: Is the total portfolio change from last month within a plausible range, or does it need explanation?
4. Lending / collateral: Were lending or collateral rows detected? Do they appear fully reconciled in the final positions?
5. Non-Directa data: Are non-listed assets admin-entered and is cash outside brokerage calculated as the residual?

End with a one-line verdict: "Ready to publish." or "Needs manual review — [reason]."`,
          },
          {
            role: "user",
            content: JSON.stringify({
              cutoffDate: args.payload.cutoffDate,
              currentPortfolioValue: args.payload.kpis.totalPortfolioValue,
              currentListedValue: args.payload.composition.listed,
              currentDirectaCash: args.payload.directaCash,
              currentCashOutsideBrokerage: args.externalCash,
              brokerageCashSource: args.payload.overlaySources?.brokerageCashSource,
              currentHoldingsCount: args.payload.holdings.length,
              previousPortfolioValue: previousTotal,
              previousDirectaCash: previousCash,
              previousHoldingsCount: previousHoldings,
              valuationMode: "Directa PDF account snapshot for positions/cash; CSV exports for transaction history",
              uploadedFiles: args.uploaded.map((file) => ({
                name: file.name,
                statementRows: file.statementRows,
                positionRows: file.positionRows,
                hasLendingOrCollateralRows: file.hasLendingOrCollateralRows,
              })),
              deterministicChecks: checkSummary,
            }, null, 2),
          },
        ],
      }),
    });
    if (!response.ok) return { summary: fallback, provider: "rules" };
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const summary = data.choices?.[0]?.message?.content?.trim();
    return summary ? { summary, provider: "openai" } : { summary: fallback, provider: "rules" };
  } catch {
    return { summary: fallback, provider: "rules" };
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB per CSV/PDF
  const MAX_MANUAL_INPUTS_BYTES = 64 * 1024; // 64 KB

  const uploadedFiles = formData.getAll("files") as File[];
  if (uploadedFiles.length === 0) {
    return NextResponse.json({ error: "No Directa files uploaded" }, { status: 400 });
  }
  for (const file of uploadedFiles) {
    if (file.size > MAX_CSV_BYTES) {
      return NextResponse.json({ error: `File "${file.name}" exceeds the 10 MB per-file limit` }, { status: 413 });
    }
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".pdf")) {
      return NextResponse.json({ error: `File "${file.name}" must be a Directa CSV or PDF` }, { status: 400 });
    }
  }

  const cutoffDateOverride = (formData.get("cutoffDateOverride") as string | null) ?? null;
  const manualInputsRaw = (formData.get("manualInputs") as string | null) ?? null;

  type ManualInputItem = {
    item_key: string;
    item_type: string;
    value: number;
    display_name?: string | null;
    subcategory?: string | null;
  };
  let formManualItems: ManualInputItem[] | null = null;
  if (manualInputsRaw) {
    if (manualInputsRaw.length > MAX_MANUAL_INPUTS_BYTES) {
      return NextResponse.json({ error: "manualInputs payload too large" }, { status: 413 });
    }
    try {
      formManualItems = JSON.parse(manualInputsRaw) as ManualInputItem[];
    } catch {
      return NextResponse.json({ error: "Invalid manualInputs JSON" }, { status: 400 });
    }
  }
  if (formManualItems === null) {
    return NextResponse.json({ error: "Manual non-Directa inputs were not submitted." }, { status: 400 });
  }

  const prisma = getPrisma();

  // Store raw files and sync parsed Directa rows into relational source tables.
  const csvFilenames: string[] = [];
  const pdfFilenames: string[] = [];
  const liquidityPdfs: DirectaLiquidityPdf[] = [];
  const uploadedCsvs: UploadedCsv[] = [];
  const syncedCsvs: DirectaSyncResult[] = [];
  const pdfUploadFiles = uploadedFiles.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
  const csvUploadFiles = uploadedFiles.filter((file) => file.name.toLowerCase().endsWith(".csv"));

  if (cutoffDateOverride) {
    for (const file of csvUploadFiles) {
      const filenameMonthEnd = monthEndFromFilename(file.name);
      if (filenameMonthEnd && filenameMonthEnd !== cutoffDateOverride) {
        return NextResponse.json(
          { error: `Selected snapshot month ends ${cutoffDateOverride}, but CSV "${file.name}" appears to be for ${filenameMonthEnd}. Select the matching month or upload the matching CSV.` },
          { status: 400 }
        );
      }
    }
  }

  for (const file of pdfUploadFiles) {
    try {
      const parsed = await syncDirectaPdfFile({
        fileName: file.name,
        content: Buffer.from(await file.arrayBuffer()),
        uploadedBy: session.email ?? "admin",
      });
      liquidityPdfs.push(parsed);
      pdfFilenames.push(file.name);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : `Could not parse Directa PDF "${file.name}"` },
        { status: 422 }
      );
    }
  }

  if (liquidityPdfs.length === 0) {
    return NextResponse.json({ error: "Upload the Directa Situazione Patrimoniale PDF so liquidity, listed value, and ISINs come from the official statement." }, { status: 400 });
  }
  const liquidityPdf = latestLiquidityPdf(liquidityPdfs)!;
  if (cutoffDateOverride && liquidityPdf.statementDate && liquidityPdf.statementDate !== cutoffDateOverride) {
    return NextResponse.json(
      { error: `Selected snapshot month ends ${cutoffDateOverride}, but the Directa PDF is dated ${liquidityPdf.statementDate}. Select the matching month or upload the matching PDF.` },
      { status: 400 }
    );
  }
  const selectedCutoffDate = cutoffDateOverride ?? liquidityPdf.statementDate ?? new Date().toISOString().slice(0, 10);

  for (const file of csvUploadFiles) {
    const content = await file.text();
    const csvMonthEnd = monthEndFromFilename(file.name) ?? selectedCutoffDate;
    uploadedCsvs.push(classifyUploadedCsv(file.name, content));
    const synced = await syncDirectaCsvFile({
      fileName: file.name,
      content,
      monthEnd: csvMonthEnd,
      uploadedBy: session.email ?? "admin",
    });
    csvFilenames.push(synced.canonicalFilename);
    syncedCsvs.push(synced);
  }
  if (csvFilenames.length === 0) {
    return NextResponse.json({ error: "No valid CSV files found (expected .csv)" }, { status: 400 });
  }
  const newFilenames = [...csvFilenames, ...pdfFilenames];

  const previousRows = await prisma.$queryRaw<Array<{ id: bigint; payload: PortfolioSnapshot }>>`
    SELECT id, payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
    ORDER BY as_of_date DESC, created_at DESC
    LIMIT 1
  `;
  const previousSnapshotId = previousRows[0] ? Number(previousRows[0].id) : null;
  const previousSnapshot = previousRows[0]?.payload ?? null;
  const previousCutoffDate = previousSnapshot?.cutoffDate ?? null;

  const sourceData = buildDirectaSourceData(syncedCsvs, previousCutoffDate);
  if (sourceData.batches.length === 0) {
    return NextResponse.json(
      { error: "No new Directa statement files were found after the current published snapshot. Upload a later Estratto Conto CSV or select the correct snapshot month." },
      { status: 400 }
    );
  }
  const usedCsvs: UploadedCsv[] = sourceData.batches.map((batch) => ({
    name: batch.canonicalFilename,
    content: "",
    statementRows: batch.statementRows,
    positionRows: batch.positionRows,
    hasLendingOrCollateralRows: batch.hasLendingOrCollateralRows,
  }));

  const nonListedValue = formManualItems
    .filter((item) => item.item_type.toLowerCase() !== "cash")
    .reduce((s, item) => s + Number(item.value), 0);
  let externalCash = 0;

  const [controlRow, fundSettings, profileRows] = await Promise.all([
    prisma.admin_controls.findFirst({
      orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
      select: { capital_committed: true, portfolio_id: true, investor_name: true },
    }),
    getFundSettings(),
    prisma.investor_profiles.findMany({
      where: { active: true },
      orderBy: [{ subscription_date: "asc" }, { name: "asc" }],
      select: { name: true, investor_type: true, capital_eur: true, units: true, subscription_date: true, nav_unit_at_sub: true },
    }),
  ]);
  const settings = calculationSettings(fundSettings);
  const snapshotProfileRows = profileRows.filter((profile) => dbDateOnly(profile.subscription_date) <= selectedCutoffDate);
  const profileCapitalCommitted = snapshotProfileRows.reduce((sum, profile) => sum + Number(profile.capital_eur), 0);
  const capitalCommitted = profileCapitalCommitted > 0
    ? profileCapitalCommitted
    : controlRow ? Number(controlRow.capital_committed) : 0;
  const approvedPortfolioId = controlRow?.portfolio_id ?? fundSettings.portfolioId;
  const approvedInvestorName = controlRow?.investor_name ?? fundSettings.fundDisplayName;

  let workbook;
  try {
    workbook = await buildWorkbookDataFromParsedRows(
      sourceData.transactions,
      sourceData.positions,
      {
        nonListedValue,
        externalCash,
        capitalCommitted,
        previousSnapshot: previousSnapshot
          ? {
              cutoffDate: previousSnapshot.cutoffDate,
              totalPortfolioValue: previousSnapshot.kpis.totalPortfolioValue,
              holdings: previousSnapshot.holdings,
              timeseries: previousSnapshot.timeseries,
              kpis: {
                totalIncome: previousSnapshot.kpis.totalIncome,
                distributionsTotal: previousSnapshot.kpis.distributionsTotal,
              },
              distributions: previousSnapshot.distributions,
            }
          : null,
      }
    );
  } catch {
    return NextResponse.json({ error: "Preprocessing failed. Verify the uploaded CSV files are valid Directa exports." }, { status: 422 });
  }

  applyPdfListedPositions(workbook, liquidityPdf);
  const brokerageCash = liquidityPdf.liquidity;
  const listedMarketValue = liquidityPdf.listedTotal;
  externalCash = calculateCashOutsideBrokerage({
    capitalCommitted,
    listedValue: listedMarketValue,
    brokerageCash,
    nonListedValue,
  });
  setWorkbookCashMetrics({
    workbook,
    listedValue: listedMarketValue,
    brokerageCash,
    cashOutsideBrokerage: externalCash,
    nonListedValue,
  });

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
    directaCash: brokerageCash,
    cutoffDate: selectedCutoffDate,
    investorName: approvedInvestorName,
    portfolioId: approvedPortfolioId,
    warnings: checkWarnings(workbook),
    investorPerformance: [],
  };
  payload.irr.valuationDate = selectedCutoffDate;

  let profileFundIrr: number | null = null;
  if (snapshotProfileRows.length > 0) {
    const totalUnits = snapshotProfileRows.reduce((s, p) => s + p.units, 0);
    const navUnit = totalUnits > 0 ? kpis.totalPortfolioValue / totalUnits : 0;
    const cutoffTs = new Date(payload.cutoffDate);
    profileFundIrr = computeFundIrrFromProfiles(snapshotProfileRows, payload.cutoffDate, kpis.totalPortfolioValue);
    if (profileFundIrr !== null) {
      payload.irr.fundIrr = profileFundIrr;
      payload.irr.investorIrr = profileFundIrr;
    }
    payload.investorPerformance = snapshotProfileRows.map((p): InvestorPerf => {
      const capitalEur = p.capital_eur;
      const units = p.units;
      const subscriptionDate = dbDateOnly(p.subscription_date);
      const yearsElapsed = (cutoffTs.getTime() - new Date(subscriptionDate).getTime()) / (365.25 * 24 * 3600 * 1000);
      const currentValueEur = units * navUnit;
      const moic = capitalEur > 0 ? currentValueEur / capitalEur : 0;
      const irrAnnualized = yearsElapsed > 0 && moic > 0 ? Math.pow(moic, 1 / yearsElapsed) - 1 : 0;
      return { name: p.name, type: p.investor_type, subscriptionDate, capitalEur, units, yearsElapsed, navUnitAtSub: p.nav_unit_at_sub, currentValueEur, moic, irrAnnualized };
    });
  } else {
    payload.irr.fundIrr = null;
    payload.irr.investorIrr = null;
  }

  const sourceRecordedAt = new Date().toISOString();
  payload.dataFreshness = {
    lastUploadAt: sourceRecordedAt,
    transactionsThrough: payload.cutoffDate,
    positionsAsOf: liquidityPdf.statementDate ?? payload.cutoffDate,
    sourceFiles: newFilenames,
  };
  payload.sourceRecordReady = true;
  payload.sourceRecordedAt = sourceRecordedAt;
  payload.overlaySources = {
    capitalCommitted,
    nonListedValue,
    externalCash,
    overlayItemCount: formManualItems.length,
    investorProfileCount: snapshotProfileRows.length,
    brokerageCashSource: { type: "directa_pdf", fileName: liquidityPdf.filename, statementDate: liquidityPdf.statementDate },
    manualItems: formManualItems.map((item) => ({
      item_key: item.item_key, item_type: item.item_type, value: Number(item.value),
      display_name: item.display_name, subcategory: item.subcategory,
    })),
  };

  const deterministicChecks = buildDeterministicChecks({
    uploaded: uploadedCsvs,
    used: usedCsvs,
    payload,
    previous: previousSnapshot,
    externalCash,
  });
  const canPublish = !deterministicChecks.some((check) => check.severity === "blocker");
  const auditSummary = await buildAiReviewSummary({ uploaded: usedCsvs, payload, previous: previousSnapshot, externalCash, checks: deterministicChecks });
  const aiSummary = auditSummary.summary;

  const auditFileName = `ariete-statement-audit-${payload.cutoffDate}.xlsx`;
  const auditWorkbook = buildAuditWorkbookBuffer(workbook);

  let snapshotId: number;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const inserted = await tx.portfolio_snapshots.create({
          data: {
            as_of_date: new Date(payload.cutoffDate),
            source_file: newFilenames.join(", "),
            payload: payload as unknown as Prisma.InputJsonValue,
            publication_status: "draft",
            audit_report: {
              status: canPublish ? "ready_to_publish" : "blocked",
              uploadedFiles: uploadedCsvs.map((file) => ({
                name: file.name, statementRows: file.statementRows,
                positionRows: file.positionRows, hasLendingOrCollateralRows: file.hasLendingOrCollateralRows,
              })),
              previousSnapshotId,
              canPublish,
              auditSummaryProvider: auditSummary.provider,
              generatedAt: sourceRecordedAt,
            } as Prisma.InputJsonValue,
            deterministic_checks: deterministicChecks as unknown as Prisma.InputJsonValue,
            ai_summary: aiSummary,
            supersedes_snapshot_id: previousSnapshotId ? BigInt(previousSnapshotId) : null,
          },
          select: { id: true },
        });
        await tx.portfolio_snapshot_artifacts.create({
          data: {
            snapshot_id: inserted.id,
            artifact_type: "preprocessed_workbook",
            file_name: auditFileName,
            mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            content: Buffer.from(auditWorkbook),
            metadata: {
              cutoffDate: payload.cutoffDate,
              sourceFiles: newFilenames,
              storedBatches: sourceData.batches.map((batch) => batch.canonicalFilename),
              generatedFrom: "statement_csv_and_directa_pdf_upload",
              brokerageCashSource: payload.overlaySources?.brokerageCashSource,
            } as Prisma.InputJsonValue,
          },
        });
        return inserted;
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
    snapshotId = Number(result.id);
  } catch {
    return NextResponse.json({ error: "Snapshot save failed. Check server logs for details." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    cutoffDate: payload.cutoffDate,
    snapshotId,
    publicationStatus: "draft",
    canPublish,
    checks: deterministicChecks,
    aiSummary,
    aiProvider: auditSummary.provider,
    previousSnapshotId,
    previousPortfolioValue: previousSnapshot?.kpis.totalPortfolioValue ?? null,
    previousCutoffDate: previousSnapshot?.cutoffDate ?? null,
    previousDirectaCash: previousDirectaCashForComparison(previousSnapshot),
    previousHoldingsCount: previousSnapshot?.holdings?.length ?? null,
    auditFileName,
    filesStored: sourceData.batches.length,
    newFiles: newFilenames,
    profileInvestorCount: snapshotProfileRows.length,
    profileFundIrr,
    portfolioValue: kpis.totalPortfolioValue,
    fundIrr: payload.irr.fundIrr,
    directaListed: payload.composition.listed,
    nonDirectaTotal: nonListedValue + externalCash,
    directaCash: payload.directaCash,
    holdingsCount: payload.holdings.length,
    warnings: payload.warnings,
    review: "Uploaded files created a draft snapshot only. Investor dashboards will update after an admin reviews and publishes this draft.",
  });
}
