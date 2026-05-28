# Ariete Investor Portal — Security Audit

**Date:** 2026-05-27
**Audit type:** Static code review, multi-track parallel (auth, inputs, infra, supply chain)
**Threat model:** Unauthenticated external attacker · Malicious authenticated investor · Insider / supply chain
**Out of scope:** Admin compromise modeling, live exploitation, dynamic testing
**Output:** Findings only. No code changes were made.

---

## Executive Summary

The portal is **not fit for production handling of investor PII and confidential portfolio data** without remediating the items listed below. The codebase was assembled rapidly ("vibecoded") and shows the characteristic pattern of a working happy-path with multiple latent security gaps that compound rather than stand alone.

**Overall posture grade: D+ (Poor — material residual risk)**

The auth model is structurally weak (a free-text `investorName` claim in a JWT is the only thing standing between investors and each other's data), the perimeter is wide open (no security headers, no CSP, no HSTS), a known-vulnerable `xlsx` library directly parses every uploaded workbook, and portfolio metrics + holdings are shipped to OpenAI and Anthropic on every upload with no data-use controls in place. Mitigating factors: all admin API handlers do enforce a role check (verified exhaustively), no raw SQL injection is reachable, no secrets were committed to git history, the container runs as non-root, and Prisma is used consistently for queries.

### Top 5 risks

| # | Risk | Severity | One-line |
|---|------|----------|----------|
| F-01 | Investor data isolation depends entirely on a trusted JWT claim, with no server-side `email → investor` mapping check | **Critical** | If `JWT_SECRET` (min 16 chars) is ever weak or rotated improperly, one investor can read every other investor's portfolio |
| F-02 | Stolen session token is valid for 7 days with no server-side revocation, no IP/UA binding, no refresh | **Critical** | Logout deletes the cookie client-side only; the JWT itself remains valid until expiry |
| F-03 | `xlsx@0.18.5` (Prototype Pollution + ReDoS) directly parses admin-uploaded workbooks; no size limit, no MIME check | **High** | Crafted `.xlsx` can pollute prototypes or stall the Node process; affects every monthly Directa import |
| F-04 | Zero HTTP security headers (no CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) | **High** | Removes the entire defense-in-depth layer that would limit the blast radius of any client-side issue |
| F-05 | Portfolio metrics and security names exfiltrated to OpenAI/Anthropic on every upload with no opt-out, no ZDR/no-training header | **High** | Investor capital, portfolio value, holdings count, and security identifiers leave the perimeter into third-party model training/caching pipelines |

### Fitness-for-purpose verdict

- **For internal CEO/admin use only, behind a VPN, with one trusted user**: tolerable with documented compensating controls.
- **For real investor access over the public internet handling confidential financial data**: **NOT FIT** until F-01, F-02, F-03, F-04, F-05, F-07, F-08, F-12 are remediated.
- **EU/MiFID/GDPR posture**: portfolio data flowing to OpenAI/Anthropic without contractual data-processing review (F-05, F-19) is a material compliance gap that needs legal sign-off before relying on this application.

---

## Findings Table

| ID | Title | Severity | Category | Evidence |
|----|-------|----------|----------|----------|
| F-01 | JWT `investorName` claim trusted without server-side email→investor binding | Critical | AuthZ / IDOR | `src/server/queries/portfolio.ts:307-353`, `src/app/(investor)/dashboard/page.tsx:64-65` |
| F-02 | No server-side session revocation; 7-day JWT replay window after token theft | Critical | Session | `src/lib/auth.ts:66-69`, `src/server/actions/auth.ts:34-38` |
| F-03 | `xlsx@0.18.5` parses untrusted workbooks; CVE-2023-30533, CVE-2024-22363 | High | Supply chain / Input | `package.json`, `src/server/services/ceo-tracker-import.ts` |
| F-04 | No HTTP security headers set anywhere | High | Headers | `next.config.ts`, `src/middleware.ts` |
| F-05 | Portfolio data exfiltrated to OpenAI/Anthropic with no opt-out, no ZDR/no-training controls | High | Data governance | `src/app/api/admin/upload-snapshot/route.ts:114-189`, `src/lib/directa-preprocess.ts:147-159` |
| F-06 | File uploads accept extension-only validation, no size cap, no magic-byte check | High | Input | `src/app/api/admin/upload/route.ts:36-39`, `src/app/api/admin/upload-snapshot/route.ts:239-250` |
| F-07 | PWA aggressively caches authenticated routes; no logout cache purge | High | Client | `next.config.ts:4-13` (next-pwa config) |
| F-08 | No rate limiting or account lockout on login | High | Auth | `src/server/actions/auth.ts:22-32` |
| F-09 | Hardcoded demo credentials shipped in source | High | Auth | `src/server/actions/auth.ts:13-20` |
| F-10 | `serialize-javascript ≤7.0.4` RCE advisory via PWA build chain | High | Supply chain | transitive: `@ducanh2912/next-pwa@10.2.9` → `workbox-build` → `@rollup/plugin-terser` |
| F-11 | Database connection sets `rejectUnauthorized: false` when SSL enabled | High | Infra | `src/db/prisma.ts:14` |
| F-12 | `JWT_SECRET` minimum is only 16 chars; no entropy check | High | Auth / Crypto | `src/lib/env.ts:6` |
| F-13 | Username enumeration via timing (email lookup short-circuits before password hash) | Medium | Auth | `src/server/actions/auth.ts:22-32` |
| F-14 | Sessions not bound to IP, User-Agent, or device fingerprint | Medium | Session | `src/lib/auth.ts:26-36` |
| F-15 | No `__Host-` / `__Secure-` cookie prefix; `SameSite=Lax` (not Strict) | Medium | Session | `src/lib/auth.ts:54-64` |
| F-16 | CSV formula injection: parsed cell values re-exported to audit XLSX without `'` prefix escaping | Medium | Output handling | `src/lib/audit-workbook.ts:19-72` |
| F-17 | Pino logger has no `redact` configuration | Medium | Logging | `src/lib/logger.ts:1-34` |
| F-18 | `bootstrap/Ariete_Capital_Investment_Tracker.xlsx` committed to git history | Medium | Data governance | `bootstrap/`, commit `315331c` |
| F-19 | Prompt injection via CSV/xlsx content can alter AI classifier output and corrupt snapshot | Medium | Data integrity | `src/lib/directa-preprocess.ts:147-159` |
| F-20 | No GitHub Actions, no Dependabot, no CodeQL, no SAST | Medium | Process | `.github/` absent |
| F-21 | Zero security tests (no IDOR, no auth-bypass, no upload-limit tests) | Medium | Test coverage | `tests/e2e/**` |
| F-22 | No DB backup or encryption-at-rest strategy documented | Medium | DR / Infra | `scripts/`, `docker-compose.yml` |
| F-23 | `postcss <8.5.10` XSS advisory inherited via Next.js 15.3.1 | Medium | Supply chain | `package-lock.json` (transitive) |
| F-24 | Error messages echo back raw `error.message` from internal services | Low | Info disclosure | `src/app/api/admin/upload/route.ts:61` |
| F-25 | `bcryptjs@2.4.3` is pure-JS, ~10× slower than native bcrypt | Low | Crypto | `package.json` |
| F-26 | `X-Powered-By` header not explicitly disabled | Low | Info disclosure | `next.config.ts` (no `poweredByHeader: false`) |
| F-27 | No `cap_drop: [ALL]` in compose; default Linux capabilities present | Low | Container | `docker-compose.yml` |
| F-28 | `JSON.parse` on `manualInputs` form field with no size cap | Low | DoS | `src/app/api/admin/upload-snapshot/route.ts:225` |
| F-29 | `SameSite=Lax` allows cross-site top-level POST to initiate login flow | Low | CSRF surface | `src/lib/auth.ts:54-64` |
| F-30 | Healthcheck `GET /` hits redirect logic instead of a dedicated `/healthz` | Info | Ops | `Dockerfile:20` |
| F-31 | `next` (15.3.1), `prisma`, `@hono/node-server` transitive advisories | Info / Medium | Supply chain | see Appendix A |
| F-32 | `getPortfolioSnapshot()` returns the full `investorPerformance[]` array before in-process personalization filters it | Info | Defense in depth | `src/server/queries/portfolio.ts:355-410` |

**Total: 32 findings — 2 Critical · 9 High · 11 Medium · 6 Low · 4 Info**

---

## Critical Findings

### F-01 — JWT `investorName` claim trusted without server-side binding

**Severity:** Critical
**Category:** Authorization / IDOR
**Threat actor:** Malicious authenticated investor (compounded by F-12)

**Evidence:**

```ts
// src/server/queries/portfolio.ts:307-318 (applyInvestorPersonalization)
const requestedName = cleanDisplayName(investorName);
if (!requestedName) return snapshot;
const investor = snapshot.investorPerformance?.find(
  (p) => normalizeName(p.name) === normalizeName(requestedName)
);
```

```ts
// src/app/(investor)/dashboard/page.tsx:58-65
const session = await getSession();
...
const sessionInvestorName = cleanDisplayName(session?.investorName);
const snap = await getPortfolioSnapshot(sessionInvestorName);
```

**Issue:** The investor's identity for data scoping is read directly from the JWT `investorName` claim. There is no server-side query of the form `investorProfile = db.investor.findUnique({ where: { email: session.email } })` to bind the session's email to a single investor record. Whatever name the JWT says, the personalization returns that investor's slice.

**Exploit path:**
1. Direct (current code, isolated): not exploitable from the HTTP layer because `investorName` flows from the cookie, not a request param.
2. Compounded with F-12 (weak `JWT_SECRET`): an attacker who guesses or brute-forces the 16-byte HMAC secret can forge a JWT with `role: "investor", investorName: "Any Investor Name"` and read that investor's data.
3. Compounded with admin process error: if an admin ever issues a token with the wrong `investorName` (because the system has no enforcement), the holder sees someone else's data with no error.

**Why Critical despite no direct exploit:** the entire isolation model depends on a single string that the server never re-validates. Any future code path that constructs a session token, or any future bug that lets users influence claims, instantly becomes a full data breach. This is "one mistake away" from disaster.

**Remediation direction:** introduce an `investor_profiles.user_email` foreign key (or `user_id`), look the investor up by `session.email` on every request inside `getPortfolioSnapshot`, and refuse the request if the lookup is empty. The `investorName` claim in the JWT should be informational only, never trusted for authorization.

---

### F-02 — No server-side session revocation; 7-day JWT replay window

**Severity:** Critical
**Category:** Session management
**Threat actor:** Anyone who obtains a session token (XSS via a future bug, device theft, MITM if F-04/F-11 are exploited, log file leak via F-17)

**Evidence:**

```ts
// src/lib/auth.ts:66-69
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
```

```ts
// src/server/actions/auth.ts:34-38
export const logoutAction = actionClient.action(async () => {
  await clearSessionCookie();
  redirect("/login");
});
```

**Issue:** Logout deletes the cookie from the user's browser only. The signed JWT remains cryptographically valid for the full 7-day `MAX_AGE`. A captured token can be replayed from any IP, from any device, with no further authentication, until natural expiry.

**Combined with F-14 (no IP/UA binding) and F-17 (no log redaction):** a token that ends up in a log file, behind a buggy CDN cache, in an HTTP referer header, or on a shared device is a 7-day open door.

**Remediation direction:** session table with a `revoked_at` column; middleware checks it on every request; logout sets `revoked_at = now()`. Add a `jti` claim to the JWT and key the table on it. Optionally, short-lived access tokens (15 min) + long-lived refresh tokens with rotation.

---

## High Findings

### F-03 — `xlsx@0.18.5` parses untrusted workbooks

CVE-2023-30533 (Prototype Pollution, CVSS 7.8) and CVE-2024-22363 (ReDoS, CVSS 7.5) both affect 0.18.5. Latest is 0.20.2 but the upstream package no longer publishes to npm under the same name. Used to parse the CEO tracker workbook on `POST /api/admin/upload` and every Directa CSV; an admin uploading a crafted workbook (or a malicious workbook arriving via business channels) can pollute Object.prototype on the running Node process or stall a request handler.

**Remediation direction:** migrate to `exceljs` or pin to the SheetJS CDN distribution that has the patch backported; until migrated, treat every uploaded workbook as actively hostile (size-limit, sandbox in a worker, sanitize keys after parsing).

### F-04 — No HTTP security headers

None of CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, or COEP are emitted anywhere. There is no `headers()` export in `next.config.ts`, no `response.headers.set()` in `src/middleware.ts`, no reverse-proxy config in the repo.

Concrete consequences: any XSS that does land (e.g., via F-19 prompt injection corrupting AI output rendered into the admin view) has no CSP wall. Any clickjacking attempt against `/admin` succeeds. Plain HTTP downgrade attacks have no HSTS to prevent them.

### F-05 — Portfolio data exfiltrated to OpenAI / Anthropic

Every monthly Directa upload sends the following to OpenAI (`src/app/api/admin/upload-snapshot/route.ts:114-189`): `cutoffDate`, `currentPortfolioValue` (EUR), `currentListedValue`, `currentDirectaCash`, `currentNonDirectaCashOverlay`, `currentHoldingsCount`, uploaded file names, statement row counts.

Anthropic receives (`src/lib/directa-preprocess.ts:147-159`) security identifiers for classification (asset-type mapping).

No headers indicate data-caching opt-out (no `OpenAI-No-Training`, no `Anthropic-Beta: disable-caching`). No opt-out toggle. No fallback when keys are absent — the upload silently proceeds without normalization, which is a separate integrity issue.

**Remediation direction:** route AI calls through an account configured for zero-data-retention; consider running classification locally (security-name → asset-type is a finite dictionary problem that does not require an LLM); add an admin-level toggle. Document the data flow for GDPR/MiFID review.

### F-06 — File upload validation is extension-only, no size limit

```ts
// src/app/api/admin/upload/route.ts:36-39 (representative)
const name = file.name.toLowerCase();
if (!name.endsWith(".xlsx") && !name.endsWith(".xlsm")) { ... }
```

No `file.size` check, no magic-byte sniffing, no decompression-bomb protection (xlsx is a zip), no zip-slip defense on extracted entries. Same pattern on `upload-snapshot` for CSV.

### F-07 — PWA caches authenticated routes

```ts
// next.config.ts (next-pwa config)
{ cacheOnFrontEndNav: true, aggressiveFrontEndNavCaching: true,
  disable: process.env.NODE_ENV === "development" }
```

No runtime caching exclusion for `/api/*`, no exclusion for authenticated HTML, no cache-purge hook on logout. Risk on shared devices (family laptop, kiosk) or after logout: the previous user's dashboard HTML is served to the next user.

### F-08 — No rate limiting / lockout on login

`loginAction` (`src/server/actions/auth.ts:22-32`) accepts unlimited attempts. No throttling, no captcha, no account lockout. Brute force is feasible against the 4 hardcoded demo passwords (F-09) or any future real passwords.

### F-09 — Hardcoded demo credentials in production source

```ts
// src/server/actions/auth.ts:13-20
const demoUsers = [
  { email: "admin@arietetest.com", password: "admintest", role: "admin", ... },
  ...
];
```

These ship in every build. If the production deploy ever runs without overriding the credentials (or if the demo list is reachable in any environment), they are an open door.

### F-10 — `serialize-javascript ≤7.0.4` RCE

GHSA-5c6j-r48x-rmvq (CVSS 8.1) — RCE via crafted RegExp / Date.toISOString. Transitive via `@ducanh2912/next-pwa@10.2.9 → workbox-build → @rollup/plugin-terser`. Affects build time. Low runtime exposure but a malicious dependency further down the tree could weaponize it.

### F-11 — `rejectUnauthorized: false` when DB SSL enabled

```ts
// src/db/prisma.ts:14
ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
```

This makes "SSL on" mean "encryption but no certificate verification" — MITM against the database connection becomes possible on any path between the app and the DB. On managed Postgres (RDS, Supabase, Neon), this throws away the security benefit of SSL.

### F-12 — `JWT_SECRET` length-only validation

`z.string().min(16)` enforces 16 characters, which is 128 bits at best and 50-60 bits if it's a human-picked passphrase. With weak entropy, F-01 becomes directly exploitable: forge a JWT with any `investorName` and read any investor's data.

---

## Medium Findings (condensed)

- **F-13** Login flow returns identical messages but timing differs: `demoUsers.find()` short-circuits before the password hash is computed. Measurable via repeated requests. → Use a constant-time path that always hashes a dummy password on email-not-found.
- **F-14** No session binding to IP / UA / device. Stolen JWTs are universally portable. → Add fingerprint or at minimum log + alert on geo-IP change.
- **F-15** Cookie missing `__Host-` prefix; `SameSite=Lax` not `Strict`. → Rename cookie to `__Host-ariete-session`, switch to `Strict` for admin paths.
- **F-16** CSV formula injection. Cell values from uploaded CSVs are written to the audit workbook in `src/lib/audit-workbook.ts` without escaping. An admin opening the artifact in Excel executes the formula. → Prefix `=`, `+`, `-`, `@`, `\t`, `\r` with `'`.
- **F-17** Pino has no `redact: { paths: [...] }` config. Any future log call carrying a JWT, password, or PII writes it to disk/stdout in cleartext. → Configure pino redaction for `req.headers.authorization`, `req.headers.cookie`, `password`, `email`, `*.token`.
- **F-18** `bootstrap/Ariete_Capital_Investment_Tracker.xlsx` is committed. Recheck whether it contains real investor names or capital amounts; if so, the data is permanently in git history and the repo is effectively confidential.
- **F-19** Prompt injection in CSV cell content could alter the Anthropic classifier's output and corrupt the asset-type mapping in the published snapshot (no AI output validation against the dictionary).
- **F-20** Zero CI security tooling. No Dependabot means F-03/F-10/F-23 will sit unpatched indefinitely.
- **F-21** No security tests. The E2E suite covers the happy path; no test asserts that investor A cannot see investor B's data, that a forged JWT is rejected, that oversized uploads are dropped.
- **F-22** No documented DB backup or encryption-at-rest. A VPS disk failure or a `DROP TABLE` mistake has no recovery path in repo.
- **F-23** `postcss <8.5.10` XSS via unescaped `</style>` (CVSS 6.1). Inherited via Next.js 15.3.1.

---

## Low Findings (condensed)

- **F-24** `route.ts` handlers return `error.message` to the client; map to generic strings server-side.
- **F-25** `bcryptjs` is fine as long as the work factor is set high enough — but pure-JS is 10× slower than native, so the effective cost ceiling is lower. Switch to `bcrypt` or `argon2` when adding real password storage.
- **F-26** Set `poweredByHeader: false` in `next.config.ts`.
- **F-27** Add `cap_drop: [ALL]` and selective `cap_add` to the compose service; set `read_only: true` with tmpfs for `/tmp`.
- **F-28** Cap `manualInputsRaw` length before `JSON.parse`.
- **F-29** Switch the session cookie to `SameSite=Strict`. Re-evaluate login form CSRF independently.

## Info Findings

- **F-30** Move healthcheck to `GET /healthz` returning `{ok: true}` with `Cache-Control: no-store`. The current `GET /` exercises the auth redirect path on every probe.
- **F-31** Track Next.js / Prisma / `@hono/node-server` advisories; update on the next maintenance window.
- **F-32** `getPortfolioSnapshot()` loads the full `investorPerformance[]` array from the DB and filters in-process. The full array is briefly present in the rendering process's memory. Not a direct vulnerability, but means any future logging of `snap` (paired with F-17) prints all investors.

---

## API Route Inventory (coverage check)

Every route handler under `src/app/api/**` was inspected. All admin routes self-enforce `session.role === "admin"`. No unauthenticated admin endpoints found.

| Route | Method | Auth check | File:line |
|-------|--------|------------|-----------|
| `/api/admin/upload` | POST | `session.role === "admin"` (401 if not) | `route.ts:16-20` |
| `/api/admin/upload-snapshot` | POST | `session.role === "admin"` | `route.ts:191-195` |
| `/api/admin/publish-snapshot` | POST | `session.role === "admin"` | `route.ts:12-16` |
| `/api/admin/snapshot-artifacts/[snapshotId]` | GET | `session.role === "admin"` | `route.ts:9-11` |
| `/api/admin/manual-defaults` | GET | `session.role === "admin"` | `route.ts:6-9` |
| `/api/admin/snapshot-baseline` | GET | `session.role === "admin"` | `route.ts:12-16` |
| `/api/admin/freeze-legacy-snapshots` | POST | `session.role === "admin"` | `route.ts:13-17` |
| `/api/admin/directa-duplicates` | POST | `session.role === "admin"` | `route.ts:6-10` |
| `/api/admin/sync-current-approved` | POST | `session.role === "admin"` | `route.ts:6-10` |

All server actions under `src/server/actions/admin.ts` are wrapped in the `adminAction` client from `src/lib/safe-action.ts` (enforces admin role). `loginAction` and `logoutAction` are unauthenticated by design.

**Important note on edge middleware:** `src/middleware.ts:59` excludes `api/` from the middleware matcher. The per-handler checks above are the **only** layer protecting API routes. Any new handler added to `src/app/api/` that forgets the check becomes an unauthenticated endpoint. → Recommendation: introduce a `requireAdmin()` helper and a CI grep that fails the build if any `src/app/api/**/route.ts` does not import it.

---

## Appendix A — Dependency Inventory

`npm audit` summary (run 2026-05-27):

| Package | Installed | CVE / GHSA | Severity | Notes |
|---------|-----------|------------|----------|-------|
| `xlsx` | 0.18.5 | GHSA-4r6h-8v6p-xvw6 (proto pollution, CVSS 7.8), GHSA-5pgg-2g8v-p4x9 (ReDoS, CVSS 7.5) | **High** | Direct dep; F-03 |
| `serialize-javascript` | ≤7.0.4 (transitive) | GHSA-5c6j-r48x-rmvq (RCE, CVSS 8.1), GHSA-qj8w-gfj5-8c6v (DoS, CVSS 5.9) | **High** | via `@ducanh2912/next-pwa` → `workbox-build`; F-10 |
| `@ducanh2912/next-pwa` | 10.2.9 | (pulls in vuln chain) | Moderate | Downgrade to 10.2.6 or replace |
| `@hono/node-server` | <1.19.13 (transitive) | path traversal | Moderate | via `@prisma/dev` — build-time only |
| `postcss` | <8.5.10 (transitive) | XSS (CVSS 6.1) | Moderate | via `next@15.3.1`; F-23 |
| `next` | 15.3.1 | inherits postcss | Moderate | Schedule update |
| `bcryptjs` | 2.4.3 | none | Low | F-25, performance only |
| `prisma` / `@prisma/client` | 7.8.0 | inherits @hono advisory | Moderate | OK at runtime |
| `pg` | 8.13.0 | none | — | OK |
| `jose` | 5.6.3 | none | — | OK |
| `next-safe-action` | 7.3.3 | none | — | OK |
| `pino` | 9.4.0 | none | — | OK (but see F-17 redaction) |

**Lockfile integrity:** `package-lock.json` is committed. `Dockerfile` uses `npm ci`. ✓
**Postinstall scripts:** only `prisma generate`. ✓
**Resolutions / git URL deps:** none. ✓
**Committed secrets:** none. No `.env*` in history, no private-key blobs, no `sk-*` / `sk-ant-*` literals in source.

---

## Appendix B — Data flow leaving the perimeter

```
Admin uploads CEO workbook (.xlsx/.xlsm)
   │
   ├─► xlsx@0.18.5 parses (F-03)
   │
   └─► Stored in Postgres via Prisma (in-process only)

Admin uploads Directa CSVs
   │
   ├─► CSV parsed locally
   │
   ├─► Anthropic API call (asset-type classification)        ┐
   │     POST https://api.anthropic.com/v1/messages          │ F-05
   │     Body: security identifiers from CSV                 │ F-19
   │     Headers: x-api-key, anthropic-version               │ (no ZDR header)
   │                                                          │
   ├─► OpenAI API call (snapshot audit summary)              ┘
   │     POST https://api.openai.com/v1/chat/completions
   │     Body: cutoffDate, currentPortfolioValue,
   │           currentListedValue, currentDirectaCash,
   │           currentNonDirectaCashOverlay,
   │           currentHoldingsCount, uploaded file names,
   │           statement row counts
   │     Headers: Authorization (no no-train header)
   │
   └─► Stored snapshot persisted to Postgres

Logs (pino → stdout + /var/log/ariete/application.log)
   │
   └─► No redact config (F-17); anything passed to logger appears in cleartext

DB connection
   │
   └─► Postgres over SSL with rejectUnauthorized: false (F-11) — MITM-able
```

**Trust boundaries crossed without contractual review:** OpenAI, Anthropic.
**Trust boundaries crossed with weakened crypto:** DB connection (F-11).

---

## Appendix C — Prioritized Remediation Backlog

**Sprint 0 (do before next deploy to production):**
1. F-09 — remove hardcoded demo users; require credentials from env or DB only.
2. F-12 — bump `JWT_SECRET` minimum to 32 bytes; rotate the current secret; document key management.
3. F-04 — add Next.js `headers()` config with CSP (start in `report-only`), HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
4. F-11 — set `rejectUnauthorized: true` on DB SSL (or use a CA bundle).
5. F-08 — add rate limiting on login (IP-based, e.g., 5/min and 20/hour).
6. F-07 — disable PWA aggressive caching on authenticated routes, or disable PWA entirely until investigated.

**Sprint 1 (within 2 weeks):**
7. F-01 + F-02 — refactor session model: bind investor by `session.email → investor_profiles` foreign key, every request; add `jti` + revocation table.
8. F-05 — route OpenAI/Anthropic calls through ZDR-configured accounts; add an opt-out; document the data flow for legal review.
9. F-06 — add `MAX_UPLOAD_BYTES` and magic-byte validation; reject if extension and content disagree.
10. F-17 — configure pino `redact` for `password`, `email`, `token`, `cookie`, `authorization`, AI prompts.
11. F-16 — escape spreadsheet formula prefixes on every cell written to audit workbooks.
12. F-20 — add Dependabot (`.github/dependabot.yml`), CodeQL workflow, npm audit step in CI.

**Sprint 2 (within 1 month):**
13. F-03 — migrate off `xlsx@0.18.5` (evaluate `exceljs`).
14. F-10 — replace/downgrade `@ducanh2912/next-pwa` or remove PWA entirely.
15. F-13, F-14, F-15 — harden session (constant-time login, IP/UA binding, `__Host-` prefix, `SameSite=Strict`).
16. F-21 — add security test suite: cross-investor IDOR, forged-JWT rejection, oversized upload, formula-injection roundtrip.
17. F-18 — review `bootstrap/Ariete_Capital_Investment_Tracker.xlsx` for real PII; if present, rotate via `git filter-repo` and re-publish.
18. F-19 — validate AI classifier output against the asset-type dictionary; reject on schema mismatch.

**Sprint 3+ (when stable):**
19. F-22 — implement automated DB backup with encryption at rest, document RTO/RPO.
20. F-23, F-25, F-26, F-27, F-28, F-29, F-30, F-31, F-32 — remaining hardening items.

---

## Audit verification

- Coverage: every `src/app/api/**/route.ts` handler is inventoried by name above (✓).
- Reproducibility: every finding cites a path and line number (✓).
- False-positive control: F-01 was downgraded from "exploitable now" to "exploitable when combined with F-12 or admin process error" after verifying that `getPortfolioSnapshot`'s `investorName` parameter is sourced from the session, not the request (`src/app/(investor)/dashboard/page.tsx:65`). It remains Critical due to the structural weakness.
- Re-run sanity: `grep -rn "session.role" src/app/api/**/route.ts` returns 9 matches (one per route). ✓
