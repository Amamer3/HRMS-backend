import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js"; 

/**
 * Assigns correlationId and captures immutable audit rows for mutating HTTP methods.
 * For high-volume reads, skip or sample in production via env flag (not shown — keep simple here).
 */
export function auditContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    req.correlationId = req.header("x-correlation-id") ?? randomUUID();
    res.setHeader("x-correlation-id", req.correlationId);
    next();
  };
}

type AuditPayload = {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
};

/**
 * Call from controllers after successful mutations.
 * AuditLog is append-only: never update/delete these rows in application code.
 */
export async function appendAuditLog(req: Request, payload: AuditPayload): Promise<void> {
  const ip = (req.ip || req.socket.remoteAddress || "").slice(0, 128);
  await prisma.auditLog.create({
    data: {
      actorUserId: req.userId ?? null,
      action: payload.action,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId ?? undefined,
      before: payload.before === undefined ? undefined : (payload.before as object),
      after: payload.after === undefined ? undefined : (payload.after as object),
      ip: ip || undefined,
      userAgent: req.headers["user-agent"]?.slice(0, 512),
      correlationId: req.correlationId,
    },
  });
}

/**
 * Express wrapper: after response finishes, optionally log (for middleware-level capture).
 * Prefer explicit appendAuditLog in services for workflow transitions (richer before/after).
 */
export function auditHttpMutations() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    const start = Date.now();
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      void prisma.auditLog
        .create({
          data: {
            actorUserId: req.userId ?? null,
            action: `http.${req.method.toLowerCase()}`,
            resourceType: "http_request",
            resourceId: null,
            after: {
              path: req.path,
              status: res.statusCode,
              durationMs: Date.now() - start,
            } as object,
            ip: req.ip,
            userAgent: req.headers["user-agent"]?.slice(0, 512),
            correlationId: req.correlationId,
          },
        })
        .catch(() => {
          /* avoid crashing response on audit failure */
        });
    });
    next();
  };
}
