import type { PrismaClient } from "../../src/generated/prisma/client";

export async function getTestPrisma(databaseUrl: string, databaseSsl?: string): Promise<PrismaClient> {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_SSL = databaseSsl ?? process.env.DATABASE_SSL ?? "false";
  process.env.JWT_SECRET ??= "test-secret-for-prisma-e2e-client-123456";

  const { getPrisma } = await import("../../src/db/prisma");
  return getPrisma();
}
