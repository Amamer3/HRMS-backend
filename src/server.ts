import "dotenv/config";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

const env = loadEnv();
const app = createApp(env);

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${env.PORT}`);
});

// Automatically purge expired blacklisted tokens once per hour
const tokenCleanupInterval = setInterval(
  async () => {
    try {
      const { count } = await prisma.tokenBlacklist.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) console.log(`Token blacklist cleanup: removed ${count} expired token(s)`);
    } catch {
      // Non-fatal — cleanup will retry next interval
    }
  },
  60 * 60 * 1000,
);

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  clearInterval(tokenCleanupInterval);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force exit if server hasn't closed within 10 seconds
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
