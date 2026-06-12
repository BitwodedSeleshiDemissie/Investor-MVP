import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // aggressive caching removed: authenticated routes would be served to the next
  // user on a shared device after logout (F-07)
  reloadOnOnline: true,
  workboxOptions: {
    disableDevLogs: true,
    // Never cache authenticated pages or API routes
    runtimeCaching: [
      {
        urlPattern: /^\/(dashboard|admin|login)(\/.*)?$/,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^\/api\//,
        handler: "NetworkOnly",
      },
    ],
  },
});

const securityHeaders = [
  { key: "X-Content-Type-Options",   value: "nosniff" },
  { key: "X-Frame-Options",          value: "DENY" },
  { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",       value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src-attr 'none'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-src 'none'",
      "child-src 'none'",
      "media-src 'none'",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  // HSTS — 2 years. Harmless in HTTP dev because browsers only enforce it after
  // the first HTTPS visit.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const privateDataHeaders = [
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pino", "pino-pretty", "pg", "xlsx"],
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: privateDataHeaders,
      },
      {
        source: "/dashboard/:path*",
        headers: privateDataHeaders,
      },
      {
        source: "/api/admin/:path*",
        headers: privateDataHeaders,
      },
      {
        source: "/login",
        headers: privateDataHeaders,
      },
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withPWA(nextConfig);
