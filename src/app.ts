import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import pino from "pino";
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

export function createApp(env: Env) {
  const logger = pino({ level: env.LOG_LEVEL });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
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
              else callback(new Error(`CORS blocked for origin: ${origin}`));
            },
      credentials: true,
    }),
  );
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
