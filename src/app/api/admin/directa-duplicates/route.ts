import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import { checkDirectaCsvDuplicate } from "@/server/directa-ingestion";

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

  const files = formData.getAll("files") as File[];
  if (files.length === 0) {
    return NextResponse.json({ duplicates: [] });
  }

  const duplicates = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".csv")) continue;
    const duplicate = await checkDirectaCsvDuplicate({
      fileName: file.name,
      content: await file.text(),
    });
    if (duplicate) duplicates.push(duplicate);
  }

  return NextResponse.json({ duplicates });
}
