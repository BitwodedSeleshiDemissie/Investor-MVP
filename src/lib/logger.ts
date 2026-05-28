import { mkdirSync } from "fs";
import path from "path";
import pino from "pino";
import pretty from "pino-pretty";
import { env } from "@/lib/env";

const isProduction = process.env.NODE_ENV === "production";
const logDir = env.LOG_DIR.trim();
const logFilePath = logDir ? path.join(logDir, env.LOG_FILE_NAME) : null;

const streams: pino.StreamEntry[] = [
  {
    stream: isProduction ? process.stdout : pretty({ colorize: true, sync: true }),
  },
];

if (logFilePath) {
  mkdirSync(logDir, { recursive: true });
  streams.push({
    stream: pino.destination({
      dest: logFilePath,
      mkdir: true,
      sync: false,
    }),
  });
}

export const logger = pino(
  {
    level: env.LOG_LEVEL || (isProduction ? "info" : "debug"),
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "*.password",
        "email",
        "*.email",
        "token",
        "*.token",
        "jwt",
        "*.jwt",
        "apiKey",
        "*.apiKey",
      ],
      censor: "[REDACTED]",
    },
  },
  pino.multistream(streams)
);
