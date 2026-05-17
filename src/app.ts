import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import pino from "pino";
import { readFileSync } from "fs";
import { join } from "path";
import { apiReference } from "@scalar/express-api-reference";
import type { Env } from "./config/env.js";
import { createAuthMiddleware } from "./middleware/authJwt.js";
import { auditContext, auditHttpMutations } from "./middleware/auditMiddleware.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { buildV1Router } from "./routes/v1/index.js";
import { buildAuthRouter, refreshSession } from "./controllers/authController.js";
import { getHealth } from "./controllers/healthController.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many requests, please try again later" },
});

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many token requests, please try again later" },
});

const openApiSpec = readFileSync(join(process.cwd(), "docs", "openapi.yaml"), "utf-8");

export function createApp(env: Env) {
  const logger = pino({ level: env.LOG_LEVEL });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // Docs routes are public and registered before helmet so Scalar's CDN is not blocked by CSP
  app.get("/api/v1/docs/openapi.yaml", (_req, res) => {
    res.type("text/yaml").send(openApiSpec);
  });
  app.use("/api/v1/docs", apiReference({ url: "/api/v1/docs/openapi.yaml" }));

  app.use(helmet());
  const corsOrigins = [env.FRONTEND_URL, "http://localhost:3000"].filter((o): o is string =>
    Boolean(o),
  );

  app.use(
    cors({
      origin:
        corsOrigins.length === 0
          ? true
          : (origin, callback) => {
              if (!origin || corsOrigins.includes(origin)) callback(null, true);
              // Pass false (not an Error) so cors skips setting the header without
              // calling next(err), which would bypass our error handler and return 500.
              else callback(null, false);
            },
      credentials: true,
    }),
  );

  // Explicit 403 for disallowed origins — runs after cors() so it only fires
  // when cors declined to set the header (origin present but not in allowlist).
  app.use((req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const origin = req.headers.origin;
    if (origin && corsOrigins.length > 0 && !corsOrigins.includes(origin)) {
      res.status(403).json({ error: "cors_blocked", message: "Origin not allowed" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));
  app.use(auditContext());

  app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "HRMS Backend API" });
  });

  app.get("/health", getHealth);

  // Auth routes — outside /api/v1 and outside auth middleware (they're the login entry point)
  app.post("/auth/refresh", refreshSession);
  app.use("/auth/azure/token", tokenLimiter);
  app.use("/auth/azure", authLimiter, buildAuthRouter(env));

  app.use("/api/v1", createAuthMiddleware(env), auditHttpMutations(), buildV1Router(env));

  app.use(errorHandler);
  return app;
}
