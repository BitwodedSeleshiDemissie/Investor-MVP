"use server";

import { z } from "zod";
import { actionClient } from "@/lib/safe-action";
import { checkPassword, setSessionCookie, clearSessionCookie, type Role } from "@/lib/auth";
import { redirect } from "next/navigation";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const demoUsers: Array<{ email: string; password: string; role: Role }> = [
  { email: "admin@arietetest.com", password: "admintest", role: "admin" },
  { email: "user@arietetest.com", password: "usertest", role: "investor" },
];

export const loginAction = actionClient.schema(loginSchema).action(async ({ parsedInput }) => {
  const email = parsedInput.email.trim().toLowerCase();
  const user = demoUsers.find((entry) => entry.email === email);

  if (!user || !checkPassword(parsedInput.password, user.password)) {
    return { error: "Credenziali non valide. Controlla email e password." };
  }

  await setSessionCookie(user.role);
  return { success: true, role: user.role };
});

export async function logoutAction() {
  "use server";
  await clearSessionCookie();
  redirect("/login");
}
