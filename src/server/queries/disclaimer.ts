import { dbEnabled, getPrisma, withDbRetry } from "@/db/prisma";

export const DISCLAIMER_VERSION = "v1";

export async function hasAcceptedDisclaimer(email: string): Promise<boolean> {
  if (!dbEnabled()) return true;
  return withDbRetry(async () => {
    const record = await getPrisma().disclaimer_acknowledgments.findUnique({
      where: { email_version: { email, version: DISCLAIMER_VERSION } },
      select: { id: true },
    });
    return record !== null;
  });
}

export async function getDisclaimerAcceptedAt(email: string): Promise<Date | null> {
  if (!dbEnabled()) return null;
  return withDbRetry(async () => {
    const record = await getPrisma().disclaimer_acknowledgments.findUnique({
      where: { email_version: { email, version: DISCLAIMER_VERSION } },
      select: { acknowledged_at: true },
    });
    return record?.acknowledged_at ?? null;
  });
}
