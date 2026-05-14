import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import pino from "pino";
import type { Env } from "./config/env.js";
import { createAuthMiddleware } from "./middleware/authJwt.js";
import { auditContext, auditHttpMutations } from "./middleware/auditMiddleware.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { buildV1Router } from "./routes/v1/index.js";
import { getHealth } from "./controllers/healthController.js";

export function createApp(env: Env) {
  const logger = pino({ level: env.LOG_LEVEL });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));
  app.use(auditContext());

  app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "HRMS Backend API" });
  });

  app.get("/health", getHealth);
  
  app.use("/api/v1", createAuthMiddleware(env), auditHttpMutations(), buildV1Router(env));
  
  app.use(errorHandler);
  return app;
}
