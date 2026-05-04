import type { Request, Response } from "express";
import { AuditQueryService } from "../services/auditQueryService.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const auditQuery = new AuditQueryService(prisma);

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditQuery.search({
    resourceType: req.query.resourceType as string | undefined,
    resourceId: req.query.resourceId as string | undefined,
    actorUserId: req.query.actorUserId as string | undefined,
    action: req.query.action as string | undefined,
    from: req.query.from ? new Date(String(req.query.from)) : undefined,
    to: req.query.to ? new Date(String(req.query.to)) : undefined,
    take: req.query.limit ? Number(req.query.limit) : req.query.take ? Number(req.query.take) : 100,
    skip: req.query.skip ? Number(req.query.skip) : undefined,
  });
  res.json(result);
});
