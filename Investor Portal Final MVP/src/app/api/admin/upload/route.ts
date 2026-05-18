import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Require admin session
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xlsm")) {
    return NextResponse.json({ error: "Only .xlsx files are accepted" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Save to the configured EXCEL_PATH (resolved from project root)
  const savePath = path.resolve(process.cwd(), env.EXCEL_PATH);
  await mkdir(path.dirname(savePath), { recursive: true });
  await writeFile(savePath, buffer);

  return NextResponse.json({
    ok: true,
    message: "Tracker uploaded successfully. Refresh the dashboard to see updated numbers.",
    fileName: file.name,
    savedTo: savePath,
  });
}
