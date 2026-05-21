import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "ariete-session";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(COOKIE_NAME)?.value;
  let session: { role: string; email?: string } | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSecret());
      session = payload as { role: string; email?: string };
    } catch {
      session = null;
    }
  }

  // Unauthenticated users trying to access protected routes
  if (!session && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Older investor cookies did not include an account email, so they cannot be
  // trusted for profile matching. Clear them at the edge and force a fresh login.
  if (session?.role === "investor" && !session.email) {
    const response = pathname === "/login"
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  // Non-admin users trying to access admin routes
  if (session && session.role !== "admin" && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Authenticated users hitting the login page
  if (session && pathname === "/login") {
    const dest = session.role === "admin" ? "/admin" : "/dashboard";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|json|js|css|txt|xml|webmanifest)$).*)",
  ],
};
