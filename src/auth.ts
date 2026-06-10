import NextAuth from "next-auth";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env } from "@/lib/env";

export type Role = "investor" | "admin";

type AuthUser = { email: string; password?: string; passwordHash?: string; role: Role; investorName?: string };

const hardcodedDevUsers: AuthUser[] = [
  { email: "local-admin@example.test", password: "local-admin-password", role: "admin" },
  {
    email: "local-investor@example.test",
    password: "local-investor-password",
    role: "investor",
    investorName: "Local Investor",
  },
];

const DUMMY_BCRYPT_HASH = "$2a$12$u8.WK00NQ4rLObYFEYA04OqSuU/CGGaRw85vRFMH6K2HGA0MH65.i";

function normalizeUser(user: AuthUser): AuthUser | null {
  const email = user.email?.trim().toLowerCase();
  if (!email || (user.role !== "admin" && user.role !== "investor")) return null;
  return {
    ...user,
    email,
    investorName: user.investorName?.trim() || undefined,
    password: user.password?.trim(),
    passwordHash: user.passwordHash?.trim(),
  };
}

function getUsers(): AuthUser[] {
  const raw = env.AUTH_USERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AuthUser[];
      return parsed.map(normalizeUser).filter((user): user is AuthUser => Boolean(user));
    } catch {
      return [];
    }
  }
  if (env.ALLOW_DEV_AUTH_USERS) return hardcodedDevUsers.map((user) => normalizeUser(user)!);
  return [];
}

function constantTimePlaintextCompare(input: string, stored: string): boolean {
  const a = input.trim();
  const b = stored.trim();
  const len = Math.max(a.length, b.length);
  let diff = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function checkPassword(input: string, found: AuthUser | undefined): Promise<boolean> {
  if (found?.passwordHash) {
    const { compare } = await import("bcryptjs");
    return compare(input, found.passwordHash);
  }
  if (found?.password && env.ALLOW_PLAINTEXT_AUTH_USERS) {
    return constantTimePlaintextCompare(input, found.password);
  }
  const { compare } = await import("bcryptjs");
  await compare(input, DUMMY_BCRYPT_HASH);
  return false;
}

// Used by auth action to get the role without re-reading cookies after signIn
export function findUser(email: string): AuthUser | undefined {
  return getUsers().find((u) => u.email === email.trim().toLowerCase());
}

declare module "next-auth" {
  interface User {
    role: Role;
    investorName?: string;
  }
  interface Session {
    user: {
      role: Role;
      investorName?: string;
    } & DefaultSession["user"];
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const email = ((credentials?.email as string) ?? "").trim().toLowerCase();
        const password = (credentials?.password as string) ?? "";
        const found = findUser(email);
        const passwordOk = await checkPassword(password, found);
        if (!found || !passwordOk) return null;
        return {
          id: email,
          email: found.email,
          name: found.investorName ?? found.email,
          role: found.role,
          investorName: found.investorName,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.investorName = user.investorName;
      } else if (token.email) {
        const currentUser = findUser(String(token.email));
        token.role = currentUser?.role;
        token.investorName = currentUser?.investorName;
      }
      return token;
    },
    async session({ session, token }) {
      const currentUser = session.user.email ? findUser(session.user.email) : undefined;
      if (currentUser) {
        session.user.role = currentUser.role;
        session.user.investorName = currentUser.investorName;
      } else if (token) {
        session.user.role = token.role as Role;
        session.user.investorName = token.investorName as string | undefined;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8,
  },
  trustHost: env.AUTH_TRUST_HOST || Boolean(process.env.VERCEL),
  secret: env.JWT_SECRET,
  pages: {
    signIn: "/login",
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
