import { NextResponse } from "next/server";
import { query, dbEnabled } from "@/db/client";
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

  const rows = await query<{
    file_name: string;
    mime_type: string;
    content: Buffer;
  }>(
    `SELECT file_name, mime_type, content
     FROM portfolio_snapshot_artifacts
     WHERE snapshot_id = $1 AND artifact_type = 'preprocessed_workbook'
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );

  const artifact = rows[0];
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
