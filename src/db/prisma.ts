import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "@/lib/env";

type G = typeof globalThis & { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const pool = new Pool({
    connectionString: env.DATABASE_URL!,
    max: 3,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  });
  pool.on("error", () => {
    // Idle connection was terminated by the DB host; drop the client so
    // the next getPrisma() call gets a fresh pool with live connections.
    (globalThis as G).prisma = undefined;
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  const g = globalThis as G;
  if (!g.prisma) g.prisma = createClient();
  return g.prisma;
}

export function resetPrisma(): void {
  (globalThis as G).prisma = undefined;
}

function isConnectionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("Connection terminated") ||
    msg.includes("ECONNRESET") ||
    msg.includes("Connection reset")
  );
}

// Retry transient connection errors (e.g. Render terminating idle connections).
// resetPrisma() is called on every connection error so the next request gets a
// fresh pool rather than reusing the broken client.
export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [1000, 3000, 5000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      lastError = e;
      resetPrisma(); // always clear the broken client
      if (attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }
  throw lastError;
}

export function dbEnabled(): boolean {
  return Boolean(env.DATABASE_URL);
}
