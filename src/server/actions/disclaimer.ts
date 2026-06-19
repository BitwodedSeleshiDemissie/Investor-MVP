"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { getPrisma } from "@/db/prisma";
import { protectedAction } from "@/lib/safe-action";
import { DISCLAIMER_VERSION } from "@/server/queries/disclaimer";

async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  return (
    hdrs.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    hdrs.get("x-real-ip")?.trim() ||
    hdrs.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

export const acceptDisclaimerAction = protectedAction
  .schema(z.object({}))
  .action(async ({ ctx: { session } }) => {
    const email = session.email;
    if (!email) throw new Error("No email in session");

    const ip = await getClientIp();

    await getPrisma().disclaimer_acknowledgments.upsert({
      where: { email_version: { email, version: DISCLAIMER_VERSION } },
      create: {
        email,
        investor_name: session.investorName ?? "",
        version: DISCLAIMER_VERSION,
        ip_address: ip,
      },
      update: {
        acknowledged_at: new Date(),
        ip_address: ip,
      },
    });

    return { success: true };
  });
