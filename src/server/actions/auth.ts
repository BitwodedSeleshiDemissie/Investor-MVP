"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut, findUser } from "@/auth";
import { actionClient } from "@/lib/safe-action";
import { checkRateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  return (
    hdrs.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    hdrs.get("x-real-ip")?.trim() ||
    hdrs.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

export const loginAction = actionClient.schema(loginSchema).action(async ({ parsedInput }) => {
  const ip = await getClientIp();
  const email = parsedInput.email.trim().toLowerCase();

  if (!checkRateLimit(`login:${ip}:${email}`) || !checkRateLimit(`login-ip:${ip}`)) {
    return { error: "Troppi tentativi. Riprova tra un minuto." };
  }

  try {
    await signIn("credentials", {
      email,
      password: parsedInput.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Credenziali non valide. Controlla email e password." };
    }
    throw error;
  }

  // Look up the role from the same credential source so the client can redirect
  // without waiting for a second round-trip to read the new cookie.
  const user = findUser(email);
  return { success: true, role: user?.role ?? "investor" };
});

export async function logoutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}
