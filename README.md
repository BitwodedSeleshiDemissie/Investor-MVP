# Ariete Investor Portal

Next.js investor portal for publishing the CEO-approved Ariete portfolio snapshot, then updating it through monthly Directa uploads and admin-entered non-Directa values.

## Database Ownership

The database schema is owned by Prisma migrations.

- Prisma schema: `prisma/schema.prisma`
- Baseline migration: `prisma/migrations/000001_init/migration.sql`
- Runtime client: `src/db/prisma.ts`

The old manual schema bootstrap scripts have been removed. Do not recreate tables from app or ops scripts; use Prisma migrations only.

## Existing Production Database

For the already-created production database, preserve the existing tables and data. Run this once to tell Prisma that the baseline schema already exists:

```bash
DATABASE_URL=<production-postgres-url> npm run prisma:resolve:init
```

That command creates/updates Prisma migration metadata only. It does not recreate or drop existing application tables.

After the baseline is resolved, every deploy can safely run:

```bash
npm run prisma:deploy
```

Run `prisma:deploy` as a release/prestart step in the deployment pipeline before the app receives traffic.

## Fresh Database

For a new empty staging or production database, run the automated bootstrap:

```bash
npm ci
npm run db:bootstrap
npm run build
npm start
```

`db:bootstrap` applies Prisma migrations and seeds the CEO-approved baseline workbook from `bootstrap/`. It is idempotent: if a CEO tracker baseline snapshot already exists, it validates that fact and skips reseeding. To intentionally reseed from the workbook:

```bash
BOOTSTRAP_FORCE=true npm run db:seed
```

The one-command VPS helper does the same thing before building the container:

```bash
sh scripts/deploy-vps.sh
```

Vercel is configured in `vercel.json` to run the same bootstrap before `next build`:

```bash
npm run db:bootstrap && npm run build
```

That means a Vercel deployment pointed at an empty Postgres database will create the schema and seed the CEO baseline during the build.

## Fund Settings

Fund assumptions are admin-managed in the portal at `/admin/settings`.

These values are stored in the `fund_settings` table and are used by new CEO workbook imports and Directa monthly snapshot calculations:

- Portfolio ID and fund display name
- Base currency and subscription pricing policy
- Risk-free rate and MOIC target
- Target equity, bond, and alternatives allocations
- Hurdle, GP carry, and catch-up assumptions for the upcoming waterfall implementation

Do not configure those assumptions through `.env`; `.env` is only for deployment secrets, database connectivity, and bootstrap file locations.

## Required Environment

```bash
DATABASE_URL=<postgres-url>
DATABASE_SSL=true # if required by the provider
JWT_SECRET=<long-random-secret>
NEXT_PUBLIC_APP_URL=https://your-domain.example
```

Optional AI audit support for Directa uploads:

```bash
OPENAI_API_KEY=<key>
OPENAI_AUDIT_MODEL=gpt-4o-mini
```

Optional baseline overrides:

```bash
CEO_BASELINE_WORKBOOK=bootstrap/Ariete_Capital_Investment_Tracker.xlsx
BASELINE_DIRECTA_CASH=87386.04
```

## Local Development

```bash
npm ci
cp .env.example .env
npm run dev
```

Useful checks before handoff or deploy:

```bash
npx prisma validate
npx tsc --noEmit
npm test
npm run build
```

## Operational Notes

- `postinstall` runs `prisma generate`, so fresh installs generate the Prisma client automatically.
- `db:bootstrap` is the deploy-time empty-database path: migrate first, seed the CEO baseline second.
- `pg` remains a dependency because Prisma's PostgreSQL adapter uses a `pg` pool with the same SSL behavior as the original DB client.
- `scripts/check-snapshot-baseline.ts` is a read-only HTTP smoke check for comparing published snapshot numbers.
- The monthly Directa workflow is handled by the admin UI and API routes; the only deploy-time seed is the CEO baseline workbook.
