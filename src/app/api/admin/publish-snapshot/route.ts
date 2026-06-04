import { NextRequest, NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import type { PortfolioSnapshot } from "@/types/portfolio";

type ReviewCheck = {
  severity?: string;
  title?: string;
  detail?: string;
};

type ApprovedManualItem = {
  item_key: string;
  item_type: string;
  value: number;
  display_name: string | null;
  subcategory: string | null;
};

function approvedManualItems(payload: PortfolioSnapshot): ApprovedManualItem[] {
  const items = payload.overlaySources?.manualItems ?? [];
  return items
    .map((item) => ({
      item_key: String(item.item_key ?? "").trim(),
      item_type: String(item.item_type ?? "").trim(),
      value: Number(item.value),
      display_name: item.display_name?.trim() || null,
      subcategory: item.subcategory?.trim() || null,
    }))
    .filter((item) => item.item_key && Number.isFinite(item.value) && item.value >= 0);
}

function normalizeDictionaryType(itemType: string): "Cash" | "Non-Listed" {
  return itemType.toLowerCase() === "cash" ? "Cash" : "Non-Listed";
}

function manualValuationMethod(itemType: string, subcategory: string | null): string {
  if (itemType.toLowerCase() === "cash") return "Approved monthly cash value";
  return subcategory ? `Approved monthly ${subcategory}` : "Approved monthly non-Directa value";
}

async function syncApprovedManualItems(
  tx: PrismaTransaction,
  payload: PortfolioSnapshot,
  asOfDate: Date
): Promise<number> {
  const items = approvedManualItems(payload);
  for (const [index, item] of items.entries()) {
    const dbItemType = normalizeDictionaryType(item.item_type);
    const displayName = item.display_name ?? item.item_key;
    const subcategory = item.subcategory ?? "";
    await tx.asset_dictionary.upsert({
      where: { item_key: item.item_key },
      create: {
        item_key: item.item_key,
        display_name: displayName,
        item_type: dbItemType,
        subcategory,
        currency: "EUR",
        active: true,
        sort_order: 1000 + index,
        notes: "Synced from approved Directa snapshot",
        updated_at: new Date(),
      },
      update: {
        display_name: displayName,
        item_type: dbItemType,
        subcategory,
        currency: "EUR",
        active: true,
        notes: "Synced from approved Directa snapshot",
        updated_at: new Date(),
      },
    });
    await tx.admin_manual_values.create({
      data: {
        as_of_date: asOfDate,
        item_key: item.item_key,
        value: item.value,
        currency: "EUR",
        valuation_source: "Approved Directa snapshot",
        valuation_method: manualValuationMethod(item.item_type, item.subcategory),
        notes: payload.cutoffDate,
      },
    });
  }
  return items.length;
}

type PrismaTransaction = Parameters<Parameters<ReturnType<typeof getPrisma>["$transaction"]>[0]>[0];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { snapshotId?: unknown; approvalNote?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const snapshotId = Number(body.snapshotId);
  if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
    return NextResponse.json({ error: "Invalid snapshot id" }, { status: 400 });
  }

  const prisma = getPrisma();
  const draft = await prisma.portfolio_snapshots.findUnique({
    where: { id: BigInt(snapshotId) },
    select: { id: true, as_of_date: true, publication_status: true, source_file: true, payload: true, deterministic_checks: true },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft snapshot not found" }, { status: 404 });
  }
  if (draft.publication_status !== "draft") {
    return NextResponse.json({ error: "Snapshot is not a draft" }, { status: 409 });
  }

  const payload = draft.payload as unknown as PortfolioSnapshot;
  const sourceRecordReady = payload.sourceRecordReady ?? false;
  if (!sourceRecordReady) {
    return NextResponse.json(
      { error: "Snapshot is not ready to publish. Re-upload to generate a Directa source record from the CSV and PDF files." },
      { status: 409 }
    );
  }

  const checks = Array.isArray(draft.deterministic_checks) ? (draft.deterministic_checks as ReviewCheck[]) : [];
  const blockers = checks.filter((check) => check.severity === "blocker");
  if (blockers.length > 0) {
    return NextResponse.json({ error: "Draft has blocking checks and cannot be published.", blockers }, { status: 409 });
  }
  const sourceFile = draft.source_file ?? "";
  const isDirectaUploadDraft = sourceFile.toLowerCase().includes(".csv") || sourceFile.toLowerCase().includes(".pdf");
  if (
    isDirectaUploadDraft &&
    (!payload.overlaySources?.brokerageCashSource || payload.overlaySources.brokerageCashSource.type !== "directa_pdf")
  ) {
    return NextResponse.json(
      { error: "This draft was created before Directa PDF validation. Re-upload the CSV exports together with the Directa PDF snapshot." },
      { status: 409 }
    );
  }
  if (!Number.isFinite(payload.directaCash) || payload.directaCash < 0 || payload.composition.cash < 0 || payload.kpis.totalPortfolioValue < 0) {
    return NextResponse.json(
      { error: "This draft contains invalid cash or NAV values. Re-upload with the Directa PDF snapshot." },
      { status: 409 }
    );
  }

  const approvalNote =
    typeof body.approvalNote === "string" && body.approvalNote.trim()
      ? body.approvalNote.trim().slice(0, 1000)
      : "Admin reviewed Directa files, checks, and audit summary.";

  const publishedAt = new Date();
  const approvedBy = session.email ?? "admin";
  const syncedManualItemCount = await prisma.$transaction(async (tx) => {
    const manualItemCount = await syncApprovedManualItems(tx, payload, new Date(payload.cutoffDate));
    await tx.portfolio_snapshots.update({
      where: { id: BigInt(snapshotId) },
      data: {
        publication_status: "published",
        published_at: publishedAt,
        approved_by: approvedBy,
        approval_note: approvalNote,
      },
    });
    return manualItemCount;
  });

  return NextResponse.json({
    ok: true,
    snapshotId,
    cutoffDate: payload.cutoffDate,
    portfolioValue: payload.kpis.totalPortfolioValue,
    holdingsCount: payload.holdings.length,
    syncedManualItemCount,
  });
}
