import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "@/lib/env";

type GlobalWithPrisma = typeof globalThis & { prisma?: PrismaClient };

function getPrismaClient(): PrismaClient {
  const g = globalThis as GlobalWithPrisma;
  if (!g.prisma) {
    const pool = new Pool({
      connectionString: env.DATABASE_URL!,
      max: 10,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    });
    const adapter = new PrismaPg(pool);
    g.prisma = new PrismaClient({ adapter });
  }
  return g.prisma;
}

export function getPrisma(): PrismaClient {
  return getPrismaClient();
}

export function dbEnabled(): boolean {
  return Boolean(env.DATABASE_URL);
}
