#!/bin/sh

# Exit on error
set -e

echo "Starting deployment script..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set"
  exit 1
fi

echo "Running database migrations..."
# Use local prisma binary to avoid npx overhead/issues
./node_modules/.bin/prisma migrate deploy

echo "Starting server..."
node dist/server.js
