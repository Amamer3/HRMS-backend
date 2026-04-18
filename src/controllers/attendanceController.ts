import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AttendanceSyncService } from "../services/attendanceSyncService.js";
import { appendAuditLog } from "../middleware/auditMiddleware.js";

const clockBody = z.object({
  branchId: z.string().uuid(),
  type: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  latitude: z.number(),
  longitude: z.number(),
  accuracyM: z.number().optional().nullable(),
  clientTimestamp: z.string().datetime(),
  idempotencyKey: z.string().uuid().optional().nullable(),
  source: z.enum(["ONLINE", "OFFLINE_SYNC"]).default("ONLINE"),
});

const syncBody = z.array(clockBody).max(50);

export async function postClock(req: Request, res: Response) {
  const body = clockBody.parse(req.body);
  if (!req.userId) {
    res.status(400).json({ error: "user_not_provisioned" });
    return;
  }

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: body.branchId } });
  const svc = new AttendanceSyncService(prisma);
  const result = await svc.applyClockEvent(
    {
      userId: req.userId,
      branchId: body.branchId,
      type: body.type,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracyM: body.accuracyM,
      clientTimestamp: new Date(body.clientTimestamp),
      idempotencyKey: body.idempotencyKey,
      source: body.source,
    },
    branch,
  );

  await appendAuditLog(req, {
    action: "attendance.clock",
    resourceType: "ClockEvent",
    resourceId: result.event.id,
    after: {
      accepted: result.event.accepted,
      distanceM: result.event.haversineDistanceM?.toString(),
    },
  });

  res.status(result.status === "created" ? 201 : 200).json(result);
}

export async function postClockSyncBatch(req: Request, res: Response) {
  const batch = syncBody.parse(req.body);
  if (!req.userId) {
    res.status(400).json({ error: "user_not_provisioned" });
    return;
  }
  const svc = new AttendanceSyncService(prisma);
  const results = [];
  for (const item of batch) {
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: item.branchId } });
    const r = await svc.applyClockEvent(
      {
        userId: req.userId,
        branchId: item.branchId,
        type: item.type,
        latitude: item.latitude,
        longitude: item.longitude,
        accuracyM: item.accuracyM,
        clientTimestamp: new Date(item.clientTimestamp),
        idempotencyKey: item.idempotencyKey,
        source: item.source,
      },
      branch,
    );
    results.push(r);
  }
  res.status(200).json({ results });
}

/** GPS audit — HR Admin / Super Admin only (enforced at router). */
export async function getClockEventsForUser(req: Request, res: Response) {
  const userId = String(req.params.userId);
  const take = req.query.take ? Number(req.query.take) : 50;
  const items = await prisma.clockEvent.findMany({
    where: { userId },
    orderBy: { serverTimestamp: "desc" },
    take,
    select: {
      id: true,
      type: true,
      latitude: true,
      longitude: true,
      accuracyM: true,
      haversineDistanceM: true,
      accepted: true,
      rejectionReason: true,
      source: true,
      clientTimestamp: true,
      serverTimestamp: true,
      branchId: true,
    },
  });
  res.json({ items });
}
