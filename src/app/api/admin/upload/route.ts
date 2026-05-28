/**
 * POST /api/admin/upload
 *
 * CEO tracker Excel workbook import — the primary source of truth for historical
 * and current portfolio data through end of CEO-managed Excel period.
 *
 * Publishes directly as a frozen snapshot:
 *   publication_status = 'published', overlays_frozen = TRUE
 */
import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/db/prisma";
import { loadWorkbookFromBuffer } from "@/lib/excel-loader";
import { getSession } from "@/lib/auth";
import { CeoTrackerImportError, importCeoTrackerWorkbook } from "@/server/services/ceo-tracker-import";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file uploaded (expected field name: 'file')" }, { status: 400 });
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "xlsx" && ext !== "xlsm") {
    return NextResponse.json({ error: "Expected .xlsx or .xlsm CEO tracker workbook" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });
  }

  let workbookData;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // XLSX/XLSM files are ZIP archives; verify the PK magic bytes
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return NextResponse.json({ error: "File content does not match an Office Open XML workbook" }, { status: 400 });
    }
    workbookData = loadWorkbookFromBuffer(buffer);
  } catch {
    return NextResponse.json({ error: "Failed to parse workbook. Ensure the file is a valid .xlsx or .xlsm." }, { status: 422 });
  }

  try {
    const result = await importCeoTrackerWorkbook({
      workbookData,
      fileName: file.name,
      approvedBy: session.email ?? "admin",
      approvalNote: "CEO tracker workbook import",
      skipIfSeeded: false,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CeoTrackerImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Snapshot save failed. Check server logs for details." }, { status: 500 });
  }
}
