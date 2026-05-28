"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { actionClient } from "@/lib/safe-action";
import { checkPassword, cleanDisplayName, setSessionCookie, clearSessionCookie, type Role } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkRateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type DemoUser = { email: string; password: string; role: Role; investorName?: string };

const hardcodedDevUsers: DemoUser[] = [
  { email: "admin@arietetest.com",   password: "admintest",   role: "admin" },
  { email: "user@arietetest.com",    password: "usertest",    role: "investor", investorName: "Osy Harrison" },
  { email: "osy@arietetest.com",     password: "osy123",      role: "investor", investorName: "Osy Harrison" },
  { email: "bradley@arietetest.com", password: "bradley123",  role: "investor", investorName: "Bradley Jackson" },
  { email: "grant@arietetest.com",   password: "grant123",    role: "investor", investorName: "Grant Kauffman" },
  { email: "esra@arietetest.com",    password: "esra123",     role: "investor", investorName: "Esra Sertoglu" },
];

function getUsers(): DemoUser[] {
  if (env.AUTH_USERS) {
    try {
      return JSON.parse(env.AUTH_USERS) as DemoUser[];
    } catch {
      return [];
    }
  }
  // Hardcoded fallback only in non-production environments
  if (process.env.NODE_ENV !== "production") {
    return hardcodedDevUsers;
  }
  return [];
}

async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

export const loginAction = actionClient.schema(loginSchema).action(async ({ parsedInput }) => {
  const ip = await getClientIp();
  if (!checkRateLimit(`login:${ip}`)) {
    return { error: "Troppi tentativi. Riprova tra un minuto." };
  }

  const email = parsedInput.email.trim().toLowerCase();
  const users = getUsers();
  const user = users.find((entry) => entry.email === email);

  if (!user || !checkPassword(parsedInput.password, user.password)) {
    return { error: "Credenziali non valide. Controlla email e password." };
  }

  await setSessionCookie({ role: user.role, email: user.email, investorName: cleanDisplayName(user.investorName) });
  return { success: true, role: user.role };
});

export async function logoutAction() {
  "use server";
  await clearSessionCookie();
  redirect("/login");
}
