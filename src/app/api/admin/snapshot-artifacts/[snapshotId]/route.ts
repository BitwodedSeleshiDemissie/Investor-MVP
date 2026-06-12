import { NextResponse } from "next/server";
import { dbEnabled, getPrisma } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import { attachmentDisposition, noStoreJson } from "@/lib/http-security";

export async function GET(
  _request: Request,
  context: { params: Promise<{ snapshotId: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return noStoreJson({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return noStoreJson({ error: "Database not configured" }, { status: 503 });
  }

  const { snapshotId } = await context.params;
  const id = Number(snapshotId);
  if (!Number.isInteger(id) || id <= 0) {
    return noStoreJson({ error: "Invalid snapshot id" }, { status: 400 });
  }

  const prisma = getPrisma();
  const artifact = await prisma.portfolio_snapshot_artifacts.findFirst({
    where: { snapshot_id: BigInt(id), artifact_type: "preprocessed_workbook" },
    orderBy: { created_at: "desc" },
    select: { file_name: true, mime_type: true, content: true },
  });

  if (!artifact) {
    return noStoreJson({ error: "Audit artifact not found" }, { status: 404 });
  }

  const body = new Blob([new Uint8Array(artifact.content)], { type: artifact.mime_type });
  return new Response(body, {
    headers: {
      "content-type": artifact.mime_type,
      "content-disposition": attachmentDisposition(artifact.file_name, "ariete-statement-audit.xlsx"),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
