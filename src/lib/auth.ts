import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";

export type Role = "investor" | "admin";

const COOKIE_NAME = "ariete-session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export async function signToken(payload: { role: Role }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<{ role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as { role: Role };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<{ role: Role } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setSessionCookie(role: Role): Promise<void> {
  const token = await signToken({ role });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export function checkPassword(input: string, stored: string): boolean {
  const normalizedInput = input.trim();
  const normalizedStored = stored.trim();
  if (normalizedInput.length !== normalizedStored.length) {
    let diff = 0;
    const len = Math.max(normalizedInput.length, normalizedStored.length);
    for (let i = 0; i < len; i++) {
      diff |= (normalizedInput.charCodeAt(i) ?? 0) ^ (normalizedStored.charCodeAt(i) ?? 0);
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < normalizedInput.length; i++) {
    diff |= normalizedInput.charCodeAt(i) ^ normalizedStored.charCodeAt(i);
  }
  return diff === 0;
}
