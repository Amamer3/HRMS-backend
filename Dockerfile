# Echt HR Platform API — multi-stage production image
FROM node:20-alpine AS build
WORKDIR /app

# prisma.config.ts requires DATABASE_URL when Prisma loads the config; generate only reads the schema.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

COPY package.json package-lock.json* ./
RUN apk update && apk upgrade --no-cache && npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY docs ./docs

RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies needed by Prisma on Alpine
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache openssl libc6-compat && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=build --chown=nodejs:nodejs /app/package.json ./
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nodejs:nodejs /app/prisma.config.ts ./
COPY --from=build --chown=nodejs:nodejs /app/docs ./docs
COPY --chown=nodejs:nodejs scripts ./scripts

RUN chmod +x ./scripts/start.sh

USER nodejs
EXPOSE 4000
CMD ["./scripts/start.sh"]
