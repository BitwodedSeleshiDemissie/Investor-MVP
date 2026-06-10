import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    JWT_SECRET: z.string().min(32),
    AUTH_USERS: z.string().optional(),
    AUTH_TRUST_HOST: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ALLOW_DEV_AUTH_USERS: z
      .enum(["true", "false"])
      .default(process.env.NODE_ENV === "development" ? "true" : "false")
      .transform((value) => value === "true"),
    ALLOW_PLAINTEXT_AUTH_USERS: z
      .enum(["true", "false"])
      .default(process.env.NODE_ENV === "development" ? "true" : "false")
      .transform((value) => value === "true"),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    ENABLE_EXTERNAL_AI_REVIEW: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ENABLE_EXTERNAL_AI_CLASSIFIER: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
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
    AUTH_USERS: process.env.AUTH_USERS,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    ALLOW_DEV_AUTH_USERS: process.env.ALLOW_DEV_AUTH_USERS,
    ALLOW_PLAINTEXT_AUTH_USERS: process.env.ALLOW_PLAINTEXT_AUTH_USERS,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ENABLE_EXTERNAL_AI_REVIEW: process.env.ENABLE_EXTERNAL_AI_REVIEW,
    ENABLE_EXTERNAL_AI_CLASSIFIER: process.env.ENABLE_EXTERNAL_AI_CLASSIFIER,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_DIR: process.env.LOG_DIR,
    LOG_FILE_NAME: process.env.LOG_FILE_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
});
