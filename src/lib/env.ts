import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    JWT_SECRET: z.string().min(16),
    ANTHROPIC_API_KEY: z.string().optional(),
    INVESTOR_NAME: z.string().default("Investor"),
    PORTFOLIO_ID: z.string().default("AI-0042"),
    RISK_FREE_RATE: z.coerce.number().default(0.035),
    MOIC_TARGET: z.coerce.number().default(2.0),
    TARGET_EQUITY_PCT: z.coerce.number().default(0.70),
    TARGET_BOND_PCT: z.coerce.number().default(0.20),
    TARGET_ALT_PCT: z.coerce.number().default(0.10),
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LOG_LEVEL: z.string().default("info"),
    LOG_DIR: z.string().default(""),
    LOG_FILE_NAME: z.string().default("application.log"),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  },
  runtimeEnv: {
    JWT_SECRET: process.env.JWT_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    INVESTOR_NAME: process.env.INVESTOR_NAME,
    PORTFOLIO_ID: process.env.PORTFOLIO_ID,
    RISK_FREE_RATE: process.env.RISK_FREE_RATE,
    MOIC_TARGET: process.env.MOIC_TARGET,
    TARGET_EQUITY_PCT: process.env.TARGET_EQUITY_PCT,
    TARGET_BOND_PCT: process.env.TARGET_BOND_PCT,
    TARGET_ALT_PCT: process.env.TARGET_ALT_PCT,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_DIR: process.env.LOG_DIR,
    LOG_FILE_NAME: process.env.LOG_FILE_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
});
