import { NextRequest, NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { buildWorkbookData, formatDateOnly, parseCsvFile, parsePositionCsvFile } from "@/lib/directa-preprocess";
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
import type { InvestorPerf, PortfolioSnapshot } from "@/types/portfolio";
import type { Prisma } from "@/generated/prisma/client";

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

function todayLocal(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function dbDateOnly(value: string | Date): string {
  if (value instanceof Date) return formatDateOnly(value);
  return String(value).split("T")[0];
}

function canonicalCsvFilename(filename: string): string {
  return filename.replace(/\s+\(\d+\)(?=\.csv$)/i, "");
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

function dedupeStoredCsvFiles(
  rows: Array<{ filename: string; content: string; month_end: string | null; uploaded_at: string }>
): Array<{ filename: string; content: string; month_end: string | null; uploaded_at: string }> {
  const byCanonicalName = new Map<string, { filename: string; content: string; month_end: string | null; uploaded_at: string }>();
  for (const row of rows) {
    byCanonicalName.set(canonicalCsvFilename(row.filename), { ...row, filename: canonicalCsvFilename(row.filename) });
  }
  return [...byCanonicalName.values()].sort((a, b) => {
    const month = String(a.month_end ?? "").localeCompare(String(b.month_end ?? ""));
    if (month !== 0) return month;
    return a.filename.localeCompare(b.filename);
  });
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
  if (snapshot.overlaySources?.source === "CEO tracker workbook") return null;
  return snapshot.directaCash ?? null;
}

function buildReviewSummary(args: {
  uploaded: UploadedCsv[];
  payload: PortfolioSnapshot;
  previous: PortfolioSnapshot | null;
  externalCash: number;
}): string {
  const statementFiles = args.uploaded.filter((file) => file.statementRows > 0).length;
  const positionFiles = args.uploaded.filter((file) => file.positionRows > 0).length;
  const valuationText = positionFiles > 0
    ? "Listed market value is based on the Directa positions export."
    : "Listed market value is based on the CEO tracker workflow: quantities from Estratto Conto trades and valuation from the latest statement trade prices.";
  const previousTotal = args.previous?.kpis.totalPortfolioValue ?? null;
  const deltaText = previousTotal && previousTotal > 0
    ? ` Portfolio value changed by ${formatMoney(args.payload.kpis.totalPortfolioValue - previousTotal)} versus the previous published snapshot.`
    : "";
  const overlayText = args.externalCash > 0
    ? ` Non-Directa cash and private overlays are being carried forward from the current tracker/manual context.`
    : "";
  const lendingText = args.uploaded.some((file) => file.hasLendingOrCollateralRows)
    ? ` Directa lending/collateral rows were detected and folded into final positions where applicable.`
    : "";
  return [
    `The upload produced a draft snapshot for ${args.payload.cutoffDate} using ${statementFiles} Directa statement file(s) and ${positionFiles} positions file(s).`,
    `${valuationText} Directa statement cash is ${formatMoney(args.payload.directaCash)}.`,
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
1. Positions & trades: Do the quantities and holdings count look coherent with the Estratto Conto trade history? If no positions file exists, that is acceptable in CEO tracker valuation mode.
2. Cash: Does the Directa cash figure make sense given the trades and income events this month?
3. Month-on-month change: Is the total portfolio change from last month within a plausible range, or does it need explanation?
4. Lending / collateral: Were lending or collateral rows detected? Do they appear fully reconciled in the final positions?
5. Non-Directa data: Is outside-Directa data (non-listed assets, external cash) being used only where Directa has no data for those items?

End with a one-line verdict: "Ready to publish." or "Needs manual review — [reason]."`,
          },
          {
            role: "user",
            content: JSON.stringify({
              cutoffDate: args.payload.cutoffDate,
              currentPortfolioValue: args.payload.kpis.totalPortfolioValue,
              currentListedValue: args.payload.composition.listed,
              currentDirectaCash: args.payload.directaCash,
              currentNonDirectaCashOverlay: args.externalCash,
              currentHoldingsCount: args.payload.holdings.length,
              previousPortfolioValue: previousTotal,
              previousDirectaCash: previousCash,
              previousHoldingsCount: previousHoldings,
              valuationMode: args.uploaded.some((file) => file.positionRows > 0)
                ? "Directa positions export"
                : "CEO tracker statement-only mode",
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

  const uploadedFiles = formData.getAll("files") as File[];
  if (uploadedFiles.length === 0) {
    return NextResponse.json({ error: "No CSV files uploaded" }, { status: 400 });
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

  // Store uploaded CSVs (upsert by filename).
  const newFilenames: string[] = [];
  const uploadedCsvs: UploadedCsv[] = [];
  for (const file of uploadedFiles) {
    if (!file.name.toLowerCase().endsWith(".csv")) continue;
    const content = await file.text();
    uploadedCsvs.push(classifyUploadedCsv(file.name, content));
    const storedName = canonicalCsvFilename(file.name);
    const monthEnd = cutoffDateOverride ?? getMonthEnd(file.name);
    await prisma.directa_csv_files.upsert({
      where: { filename: storedName },
      create: { filename: storedName, month_end: monthEnd ? new Date(monthEnd) : null, content },
      update: { content, uploaded_at: new Date() },
    });
    newFilenames.push(storedName);
  }
  if (newFilenames.length === 0) {
    return NextResponse.json({ error: "No valid CSV files found (expected .csv)" }, { status: 400 });
  }

  // Load full CSV history.
  const storedFileRows = await prisma.$queryRaw<Array<{
    filename: string;
    content: string;
    month_end: string | null;
    uploaded_at: string;
  }>>`
    SELECT filename, content, month_end::text, uploaded_at::text
    FROM directa_csv_files
    ORDER BY month_end ASC NULLS LAST, uploaded_at ASC, filename ASC
  `;
  const storedFiles = dedupeStoredCsvFiles(storedFileRows);
  if (storedFiles.length === 0) {
    return NextResponse.json({ error: "No CSV files stored" }, { status: 400 });
  }

  const previousRows = await prisma.$queryRaw<Array<{ id: bigint; payload: PortfolioSnapshot }>>`
    SELECT id, payload
    FROM portfolio_snapshots
    WHERE publication_status = 'published'
      AND COALESCE(source_file, '') NOT ILIKE 'CEO tracker context:%'
    ORDER BY as_of_date DESC, created_at DESC
    LIMIT 1
  `;
  const previousSnapshotId = previousRows[0] ? Number(previousRows[0].id) : null;
  const previousSnapshot = previousRows[0]?.payload ?? null;
  const previousCutoffDate = previousSnapshot?.cutoffDate ?? null;
  const filesForSnapshot = previousCutoffDate
    ? storedFiles.filter((file) => !file.month_end || file.month_end > previousCutoffDate)
    : storedFiles;
  if (filesForSnapshot.length === 0) {
    return NextResponse.json(
      { error: "No new Directa statement files were found after the current published snapshot. Upload a later Estratto Conto CSV or select the correct snapshot month." },
      { status: 400 }
    );
  }
  const usedCsvs = filesForSnapshot.map((file) => classifyUploadedCsv(file.filename, file.content));

  const nonListedValue = formManualItems
    .filter((item) => item.item_type.toLowerCase() !== "cash")
    .reduce((s, item) => s + Number(item.value), 0);
  const externalCash = formManualItems
    .filter((item) => item.item_type.toLowerCase() === "cash")
    .reduce((s, item) => s + Number(item.value), 0);

  const [controlRow, fundSettings] = await Promise.all([
    prisma.admin_controls.findFirst({
      orderBy: [{ as_of_date: "desc" }, { created_at: "desc" }],
      select: { capital_committed: true, portfolio_id: true, investor_name: true },
    }),
    getFundSettings(),
  ]);
  const settings = calculationSettings(fundSettings);
  const capitalCommitted = controlRow ? Number(controlRow.capital_committed) : 0;
  const approvedPortfolioId = controlRow?.portfolio_id ?? fundSettings.portfolioId;
  const approvedInvestorName = controlRow?.investor_name ?? fundSettings.fundDisplayName;

  let workbook;
  try {
    workbook = await buildWorkbookData(
      filesForSnapshot.map((f) => ({ name: f.filename, content: f.content })),
      {
        nonListedValue,
        externalCash,
        capitalCommitted,
        baselineSnapshot: previousSnapshot
          ? {
              cutoffDate: previousSnapshot.cutoffDate,
              totalPortfolioValue: previousSnapshot.kpis.totalPortfolioValue,
              holdings: previousSnapshot.holdings,
              timeseries: previousSnapshot.timeseries,
            }
          : null,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Preprocessing failed: ${msg}` }, { status: 422 });
  }

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
    directaCash: Number(workbook.portfolioMetrics["Statement Cash"] ?? workbook.portfolioMetrics["Directa Cash"] ?? 0),
    cutoffDate: formatDateOnly(workbook.cutoffDate),
    investorName: approvedInvestorName,
    portfolioId: approvedPortfolioId,
    warnings: checkWarnings(workbook),
    investorPerformance: [],
  };
  if (cutoffDateOverride) {
    payload.cutoffDate = cutoffDateOverride;
    payload.irr.valuationDate = cutoffDateOverride;
  }

  const profileRows = await prisma.investor_profiles.findMany({
    where: { active: true },
    orderBy: [{ subscription_date: "asc" }, { name: "asc" }],
    select: { name: true, investor_type: true, capital_eur: true, units: true, subscription_date: true, nav_unit_at_sub: true },
  });
  let profileFundIrr: number | null = null;
  if (profileRows.length > 0) {
    const totalUnits = profileRows.reduce((s, p) => s + p.units, 0);
    const navUnit = totalUnits > 0 ? kpis.totalPortfolioValue / totalUnits : 0;
    const cutoffTs = new Date(payload.cutoffDate);
    profileFundIrr = computeFundIrrFromProfiles(profileRows, payload.cutoffDate, kpis.totalPortfolioValue);
    if (profileFundIrr !== null) {
      payload.irr.fundIrr = profileFundIrr;
      payload.irr.investorIrr = profileFundIrr;
    }
    payload.investorPerformance = profileRows.map((p): InvestorPerf => {
      const capitalEur = p.capital_eur;
      const units = p.units;
      const subscriptionDate = dbDateOnly(p.subscription_date);
      const yearsElapsed = (cutoffTs.getTime() - new Date(subscriptionDate).getTime()) / (365.25 * 24 * 3600 * 1000);
      const currentValueEur = units * navUnit;
      const moic = capitalEur > 0 ? currentValueEur / capitalEur : 0;
      const irrAnnualized = yearsElapsed > 0 && moic > 0 ? Math.pow(moic, 1 / yearsElapsed) - 1 : 0;
      return { name: p.name, type: p.investor_type, subscriptionDate, capitalEur, units, yearsElapsed, navUnitAtSub: p.nav_unit_at_sub, currentValueEur, moic, irrAnnualized };
    });
  }

  const frozenAt = new Date().toISOString();
  payload.overlaysFrozen = true;
  payload.frozenAt = frozenAt;
  payload.overlaySources = {
    capitalCommitted,
    nonListedValue,
    externalCash,
    overlayItemCount: formManualItems.length,
    investorProfileCount: profileRows.length,
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
    const result = await prisma.$transaction(async (tx) => {
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
            generatedAt: frozenAt,
          } as Prisma.InputJsonValue,
          deterministic_checks: deterministicChecks as unknown as Prisma.InputJsonValue,
          ai_summary: aiSummary,
          supersedes_snapshot_id: previousSnapshotId ? BigInt(previousSnapshotId) : null,
          overlays_frozen: true,
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
            storedFiles: storedFiles.map((file) => file.filename),
            generatedFrom: "statement_csv_upload",
          } as Prisma.InputJsonValue,
        },
      });
      return inserted;
    });
    snapshotId = Number(result.id);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Snapshot save failed: ${msg}` }, { status: 500 });
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
    filesStored: storedFiles.length,
    newFiles: newFilenames,
    profileInvestorCount: profileRows.length,
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
