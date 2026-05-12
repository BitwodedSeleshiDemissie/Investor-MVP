import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    JWT_SECRET: z.string().min(16),
    INVESTOR_PASSWORD: z.string().min(1),
    ADMIN_PASSWORD: z.string().min(1),
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
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  },
  runtimeEnv: {
    JWT_SECRET: process.env.JWT_SECRET,
    INVESTOR_PASSWORD: process.env.INVESTOR_PASSWORD,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    INVESTOR_NAME: process.env.INVESTOR_NAME,
    PORTFOLIO_ID: process.env.PORTFOLIO_ID,
    RISK_FREE_RATE: process.env.RISK_FREE_RATE,
    MOIC_TARGET: process.env.MOIC_TARGET,
    TARGET_EQUITY_PCT: process.env.TARGET_EQUITY_PCT,
    TARGET_BOND_PCT: process.env.TARGET_BOND_PCT,
    TARGET_ALT_PCT: process.env.TARGET_ALT_PCT,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
});
