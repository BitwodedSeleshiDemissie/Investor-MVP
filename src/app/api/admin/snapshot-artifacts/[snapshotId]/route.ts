import { NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ snapshotId: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { snapshotId } = await context.params;
  const id = Number(snapshotId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid snapshot id" }, { status: 400 });
  }

  const prisma = getPrisma();
  const artifact = await prisma.portfolio_snapshot_artifacts.findFirst({
    where: { snapshot_id: BigInt(id), artifact_type: "preprocessed_workbook" },
    orderBy: { created_at: "desc" },
    select: { file_name: true, mime_type: true, content: true },
  });

  if (!artifact) {
    return NextResponse.json({ error: "Audit artifact not found" }, { status: 404 });
  }

  const body = new Blob([new Uint8Array(artifact.content)], { type: artifact.mime_type });
  return new Response(body, {
    headers: {
      "content-type": artifact.mime_type,
      "content-disposition": `attachment; filename="${artifact.file_name}"`,
      "cache-control": "no-store",
    },
  });
}
