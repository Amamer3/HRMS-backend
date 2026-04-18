import type { Request, Response } from "express";

export function getMe(req: Request, res: Response) {
  res.json({
    entraOid: req.auth?.oid,
    email: req.auth?.email,
    roles: req.appRoles ?? [],
    internalUserId: req.userId ?? null,
  });
}
