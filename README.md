# Investor MVP

Investor portal MVP built with Next.js, React, TypeScript, and Tailwind CSS.

## Local development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Copy `.env.example` to `.env` and fill in the required values before running the app locally.

## VPS deployment

The repository now includes a production `Dockerfile` and `docker-compose.yml`.

1. Copy `.env.example` to `.env` and fill in production values.
2. Start the application:

```bash
docker compose up -d --build
```

3. Application logs are written to both container stdout and `./runtime/logs/application.log` on the host for easier monitoring and rotation.

The compose setup assumes the database is provided separately through `DATABASE_URL`.
