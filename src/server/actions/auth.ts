"use server";

import { z } from "zod";
import { actionClient } from "@/lib/safe-action";
import { checkPassword, cleanDisplayName, setSessionCookie, clearSessionCookie, type Role } from "@/lib/auth";
import { redirect } from "next/navigation";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const demoUsers: Array<{ email: string; password: string; role: Role; investorName?: string }> = [
  { email: "admin@arietetest.com",   password: "admintest",   role: "admin" },
  { email: "user@arietetest.com",    password: "usertest",    role: "investor", investorName: "Osy Harrison" },
  { email: "osy@arietetest.com",     password: "osy123",      role: "investor", investorName: "Osy Harrison" },
  { email: "bradley@arietetest.com", password: "bradley123",  role: "investor", investorName: "Bradley Jackson" },
  { email: "grant@arietetest.com",   password: "grant123",    role: "investor", investorName: "Grant Kauffman" },
  { email: "esra@arietetest.com",    password: "esra123",     role: "investor", investorName: "Esra Sertoglu" },
];

export const loginAction = actionClient.schema(loginSchema).action(async ({ parsedInput }) => {
  const email = parsedInput.email.trim().toLowerCase();
  const user = demoUsers.find((entry) => entry.email === email);

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
