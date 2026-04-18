import type { NextFunction, Request, Response } from "express";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "internal_error";
  const message = err instanceof Error ? err.message : "Unexpected error";
  const status = code === "WORKFLOW_ILLEGAL_TRANSITION" ? 409 : 500;
  res.status(status).json({ error: code, message });
}
