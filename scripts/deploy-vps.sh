#!/usr/bin/env sh
set -eu

echo "Installing dependencies..."
npm ci

echo "Applying Prisma migrations and seeding the CEO baseline if needed..."
npm run db:bootstrap

echo "Building application..."
npm run build

echo "Starting application container..."
docker compose up -d --build

echo "Deployment complete."
