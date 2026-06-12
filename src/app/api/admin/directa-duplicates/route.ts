import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/db/prisma";
import { getSession } from "@/lib/auth";
import { rejectCrossOriginRequest } from "@/lib/http-security";
import { DIRECTA_UPLOAD_LIMITS, formatBytes, totalUploadBytes } from "@/lib/upload-limits";
import { checkDirectaCsvDuplicate } from "@/server/directa-ingestion";

export async function POST(req: NextRequest) {
  const originRejection = rejectCrossOriginRequest(req);
  if (originRejection) return originRejection;

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
  if (files.length > DIRECTA_UPLOAD_LIMITS.maxFiles) {
    return NextResponse.json(
      { error: `Upload at most ${DIRECTA_UPLOAD_LIMITS.maxFiles} Directa files at a time` },
      { status: 413 }
    );
  }
  const totalBytes = totalUploadBytes(files);
  if (totalBytes > DIRECTA_UPLOAD_LIMITS.maxTotalBytes) {
    return NextResponse.json(
      { error: `Upload batch exceeds the ${formatBytes(DIRECTA_UPLOAD_LIMITS.maxTotalBytes)} total limit` },
      { status: 413 }
    );
  }

  const duplicates = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".csv")) continue;
    if (file.size > DIRECTA_UPLOAD_LIMITS.maxFileBytes) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds the ${formatBytes(DIRECTA_UPLOAD_LIMITS.maxFileBytes)} per-file limit` },
        { status: 413 }
      );
    }
    const duplicate = await checkDirectaCsvDuplicate({
      fileName: file.name,
      content: await file.text(),
    });
    if (duplicate) duplicates.push(duplicate);
  }

  return NextResponse.json({ duplicates });
}
