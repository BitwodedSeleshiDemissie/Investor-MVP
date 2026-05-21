import { NextRequest, NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import type { PortfolioSnapshot } from "@/types/portfolio";

type ReviewCheck = {
  severity?: string;
  title?: string;
  detail?: string;
};

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
    select: { id: true, as_of_date: true, publication_status: true, payload: true, deterministic_checks: true },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft snapshot not found" }, { status: 404 });
  }
  if (draft.publication_status !== "draft") {
    return NextResponse.json({ error: "Snapshot is not a draft" }, { status: 409 });
  }

  const payload = draft.payload as unknown as PortfolioSnapshot;
  if (!payload.overlaysFrozen) {
    return NextResponse.json(
      { error: "Snapshot is not ready to publish. Re-upload to generate a self-contained approved snapshot." },
      { status: 409 }
    );
  }

  const checks = Array.isArray(draft.deterministic_checks) ? (draft.deterministic_checks as ReviewCheck[]) : [];
  const blockers = checks.filter((check) => check.severity === "blocker");
  if (blockers.length > 0) {
    return NextResponse.json({ error: "Draft has blocking checks and cannot be published.", blockers }, { status: 409 });
  }

  const approvalNote =
    typeof body.approvalNote === "string" && body.approvalNote.trim()
      ? body.approvalNote.trim().slice(0, 1000)
      : "Admin reviewed Directa files, checks, and audit summary.";

  await prisma.portfolio_snapshots.update({
    where: { id: BigInt(snapshotId) },
    data: {
      publication_status: "published",
      published_at: new Date(),
      approved_by: session.email ?? "admin",
      approval_note: approvalNote,
    },
  });

  return NextResponse.json({
    ok: true,
    snapshotId,
    cutoffDate: payload.cutoffDate,
    portfolioValue: payload.kpis.totalPortfolioValue,
    holdingsCount: payload.holdings.length,
  });
}
