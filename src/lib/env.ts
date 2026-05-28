import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    JWT_SECRET: z.string().min(32),
    AUTH_USERS: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    EXCEL_PATH: z.string().default("./bootstrap/Ariete_Capital_Investment_Tracker.xlsx"),
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    CEO_BASELINE_WORKBOOK: z.string().optional(),
    BASELINE_DIRECTA_CASH: z.coerce.number().optional(),
    BOOTSTRAP_FORCE: z
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
    AUTH_USERS: process.env.AUTH_USERS,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    EXCEL_PATH: process.env.EXCEL_PATH,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL,
    CEO_BASELINE_WORKBOOK: process.env.CEO_BASELINE_WORKBOOK,
    BASELINE_DIRECTA_CASH: process.env.BASELINE_DIRECTA_CASH,
    BOOTSTRAP_FORCE: process.env.BOOTSTRAP_FORCE,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_DIR: process.env.LOG_DIR,
    LOG_FILE_NAME: process.env.LOG_FILE_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
});
