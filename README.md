# Ariete Investor Portal

Next.js investor portal for publishing Ariete portfolio snapshots from monthly Directa CSV exports, the Directa PDF account snapshot, and admin-entered non-Directa values.

## Database Ownership

The database schema is owned by Prisma migrations.

- Prisma schema: `prisma/schema.prisma`
- Initial migration: `prisma/migrations/000001_init/migration.sql`
- Runtime client: `src/db/prisma.ts`

The old manual schema scripts and historical staging-table migrations have been removed. Do not recreate tables from app or ops scripts; use Prisma migrations only.

## Existing Production Database

For the already-created production database, preserve the existing tables and data. Run this once to tell Prisma that the initial schema already exists:

```bash
DATABASE_URL=<production-postgres-url> npm run prisma:resolve:init
```

That command creates/updates Prisma migration metadata only. It does not recreate or drop existing application tables.

After the initial migration is resolved, every deploy can safely run:

```bash
npm run prisma:deploy
```

Run `prisma:deploy` as a release/prestart step in the deployment pipeline before the app receives traffic.

## Fresh Database

For a new empty staging or production database, install dependencies, apply Prisma migrations, and build:

```bash
npm ci
npm run prisma:deploy
npm run build
npm start
```

The one-command VPS helper does the same thing before building the container:

```bash
sh scripts/deploy-vps.sh
```

Vercel is configured in `vercel.json` to apply Prisma migrations before `next build`:

```bash
npm run prisma:deploy && npm run build
```

That means a Vercel deployment pointed at an empty Postgres database will create the schema during the build. Snapshot data is loaded through the admin Directa upload flow.

## Fund Settings

Fund assumptions are admin-managed in the portal at `/admin/settings`.

These values are stored in the `fund_settings` table and are used by Directa monthly snapshot calculations:

- Portfolio ID and fund display name
- Base currency and subscription pricing policy
- Risk-free rate and MOIC target
- Target equity, bond, and alternatives allocations
- Hurdle, GP carry, and catch-up assumptions for the upcoming waterfall implementation

Do not configure those assumptions through `.env`; `.env` is only for deployment secrets, database connectivity, logging, and public app URL.

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
- There is no deploy-time data seed; snapshots are created from the admin Directa upload flow.
- `pg` remains a dependency only as Prisma's PostgreSQL adapter transport; application and tests use Prisma.
- The monthly Directa workflow is handled by the admin UI and API routes.
