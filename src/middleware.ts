import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  if (!session && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (session && session.user?.role !== "admin" && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (session && pathname === "/login") {
    const dest = session.user?.role === "admin" ? "/admin" : "/dashboard";
    return NextResponse.redirect(new URL(dest, req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|json|js|css|txt|xml|webmanifest)$).*)",
  ],
};
