#!/bin/sh

# Exit on error
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting server..."
node dist/server.js
