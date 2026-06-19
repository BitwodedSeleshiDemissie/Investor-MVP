import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { dbEnabled } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import { loadWorkbookFromBuffer } from "@/lib/excel-loader";
import { importCeoTrackerWorkbook } from "@/server/services/ceo-tracker-import";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const workbookPath = path.resolve(process.cwd(), "bootstrap", "Ariete_Capital_Investment_Tracker.xlsx");
  if (!fs.existsSync(workbookPath)) {
    return NextResponse.json(
      { error: "Baseline workbook not found in bootstrap/. Re-deploy the app with the workbook committed." },
      { status: 404 }
    );
  }

  try {
    const workbookData = loadWorkbookFromBuffer(fs.readFileSync(workbookPath));
    const result = await importCeoTrackerWorkbook({
      workbookData,
      fileName: "Ariete_Capital_Investment_Tracker.xlsx",
      approvedBy: session.email ?? "admin",
      approvalNote: "CEO tracker baseline seeded from admin dashboard",
      baselineDirectaCash: 87386.04,
      skipIfSeeded: false,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
