import type { Request, Response } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  res.json({
    entraOid: req.auth?.oid,
    email: req.auth?.email,
    roles: req.appRoles ?? [],
    internalUserId: req.userId ?? null,
  });
});
