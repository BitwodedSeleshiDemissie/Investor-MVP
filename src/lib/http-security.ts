import { NextResponse } from "next/server";

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function normalizedHost(value: string | null): string | null {
  const host = firstHeaderValue(value)?.toLowerCase();
  return host || null;
}

function requestHost(req: Request): string | null {
  return (
    normalizedHost(req.headers.get("x-forwarded-host")) ??
    normalizedHost(req.headers.get("host")) ??
    normalizedHost(new URL(req.url).host)
  );
}

function allowedOriginHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const host = requestHost(req);
  if (host) hosts.add(host);

  try {
    hosts.add(new URL(req.url).host.toLowerCase());
  } catch {
    // Invalid request URLs are handled by the route itself.
  }

  const publicUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (publicUrl) {
    try {
      hosts.add(new URL(publicUrl).host.toLowerCase());
    } catch {
      // Ignore malformed optional deployment hints.
    }
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) hosts.add(vercelUrl.toLowerCase());

  return hosts;
}

export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    return allowedOriginHosts(req).has(originUrl.host.toLowerCase());
  } catch {
    return false;
  }
}

export function rejectCrossOriginRequest(req: Request): NextResponse<{ error: string }> | null {
  if (isSameOriginRequest(req)) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function noStoreJson<T>(body: T, init?: ResponseInit): NextResponse<T> {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export function attachmentDisposition(filename: string, fallback = "download.bin"): string {
  const cleaned = filename
    .replace(/[\r\n]/g, " ")
    .replace(/[\\/:*?"<>|;]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || fallback;
  const ascii = cleaned.replace(/"/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}
