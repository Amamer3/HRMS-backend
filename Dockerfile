# Echt HR Platform API — multi-stage production image
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN apk update && apk upgrade --no-cache && npm ci

COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY docs ./docs

RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk update && apk upgrade --no-cache && addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/docs ./docs
COPY scripts ./scripts

RUN chmod +x ./scripts/start.sh

USER nodejs
EXPOSE 4000
CMD ["./scripts/start.sh"]
