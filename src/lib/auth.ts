// Thin compatibility layer — all existing callers (API routes, server components,
// safe-action, tests) continue to import from here unchanged.
import { auth } from "@/auth";
export type { Role } from "@/auth";

export interface Session {
  role: import("@/auth").Role;
  email?: string;
  investorName?: string;
}

export function cleanDisplayName(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^["']+|["']+$/g, "").trim() || undefined;
}

export async function getSession(): Promise<Session | null> {
  const s = await auth();
  if (!s?.user?.email) return null;
  return {
    role: s.user.role,
    email: s.user.email,
    investorName: cleanDisplayName(s.user.investorName),
  };
}
