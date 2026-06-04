#!/usr/bin/env sh
set -eu

echo "Installing dependencies..."
npm ci

echo "Applying Prisma migrations and seeding initial approved tracker data if needed..."
npm run db:bootstrap

echo "Building application..."
npm run build

echo "Starting application container..."
docker compose up -d --build

echo "Deployment complete."
