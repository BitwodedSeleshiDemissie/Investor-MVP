import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbEnabled } from "@/db/prisma";
import { syncCurrentApprovedSnapshot } from "@/server/actions/admin";

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dbEnabled()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  await syncCurrentApprovedSnapshot();
  return NextResponse.json({ ok: true });
}
