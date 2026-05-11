import { Pool } from "pg";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    });
    pool.on("error", (err) => logger.error({ err }, "DB pool error"));
  }
  return pool;
}

export function dbEnabled(): boolean {
  return Boolean(env.DATABASE_URL);
}

export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  const result = await p.query(sql, params);
  return result.rows as T[];
}
