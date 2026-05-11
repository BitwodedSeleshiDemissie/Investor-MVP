"use server";

import { z } from "zod";
import { actionClient } from "@/lib/safe-action";
import { checkPassword, setSessionCookie, clearSessionCookie, type Role } from "@/lib/auth";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";

const loginSchema = z.object({
  password: z.string().min(1),
  role: z.enum(["investor", "admin"]),
});

export const loginAction = actionClient.schema(loginSchema).action(async ({ parsedInput }) => {
  const { password, role } = parsedInput;
  const stored = role === "admin" ? env.ADMIN_PASSWORD : env.INVESTOR_PASSWORD;
  const valid =
    checkPassword(password, stored) ||
    (role === "admin" && checkPassword(password, env.INVESTOR_PASSWORD));
  if (!valid) {
    return { error: "Password non corretta" };
  }
  await setSessionCookie(role as Role);
  return { success: true, role };
});

export async function logoutAction() {
  "use server";
  await clearSessionCookie();
  redirect("/login");
}
