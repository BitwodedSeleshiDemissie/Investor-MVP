import NextAuth from "next-auth";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

export type Role = "investor" | "admin";

type AuthUser = { email: string; password: string; role: Role; investorName?: string };

const hardcodedDevUsers: AuthUser[] = [
  { email: "admin@arietetest.com",   password: "admintest",   role: "admin" },
  { email: "user@arietetest.com",    password: "usertest",    role: "investor", investorName: "Osy Harrison" },
  { email: "osy@arietetest.com",     password: "osy123",      role: "investor", investorName: "Osy Harrison" },
  { email: "bradley@arietetest.com", password: "bradley123",  role: "investor", investorName: "Bradley Jackson" },
  { email: "grant@arietetest.com",   password: "grant123",    role: "investor", investorName: "Grant Kauffman" },
  { email: "esra@arietetest.com",    password: "esra123",     role: "investor", investorName: "Esra Sertoglu" },
];

function getUsers(): AuthUser[] {
  const raw = process.env.AUTH_USERS;
  if (raw) {
    try { return JSON.parse(raw) as AuthUser[]; } catch { return []; }
  }
  if (process.env.NODE_ENV !== "production") return hardcodedDevUsers;
  return [];
}

// Constant-time string comparison
function checkPassword(input: string, stored: string): boolean {
  const a = input.trim();
  const b = stored.trim();
  const len = Math.max(a.length, b.length);
  let diff = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
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
        if (!found || !checkPassword(password, found.password)) return null;
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
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.role = token.role as Role;
        session.user.investorName = token.investorName as string | undefined;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24, // 1 day (was 7 days)
  },
  // Reuse the existing JWT_SECRET env var so no deployment change is needed
  secret: process.env.JWT_SECRET,
  pages: {
    signIn: "/login",
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
