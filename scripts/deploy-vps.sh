#!/usr/bin/env sh
set -eu

echo "Installing dependencies..."
npm ci

echo "Applying Prisma migrations..."
npm run prisma:deploy

echo "Building application..."
npm run build

echo "Starting application container..."
docker compose up -d --build

echo "Deployment complete."
