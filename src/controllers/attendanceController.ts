import type { Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AttendanceSyncService } from "../services/attendanceSyncService.js";
import { appendAuditLog } from "../middleware/auditMiddleware.js";
import { BadRequestError, UnauthorizedError } from "../lib/errors.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const clockBody = z.object({
  branchId: z.string().uuid().optional().nullable(),
  branch_id: z.string().uuid().optional().nullable(), // Map from frontend
  type: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  lat: z.coerce.number().optional(), // Map from frontend
  lng: z.coerce.number().optional(), // Map from frontend
  accuracyM: z.coerce.number().optional().nullable(),
  accuracy: z.coerce.number().optional().nullable(), // Map from frontend
  clientTimestamp: z.string().datetime().optional(),
  idempotencyKey: z.string().uuid().optional().nullable(),
  source: z.enum(["ONLINE", "OFFLINE_SYNC"]).default("ONLINE"),
});

const syncBody = z.array(clockBody).max(50);

const correctionBody = z.object({
  missed_date: z.string(), // YYYY-MM-DD
  reason: z.string(),
});

/**
 * Shared logic for clocking in/out.
 */
async function handleClock(req: Request, res: Response, type: "CLOCK_IN" | "CLOCK_OUT") {
  req.body.type = type;
  const body = clockBody.parse(req.body);
  if (!req.userId) {
    throw new UnauthorizedError("User not provisioned");
  }

  // Map fields from frontend
  const lat = body.lat ?? body.latitude;
  const lng = body.lng ?? body.longitude;
  const accuracy = body.accuracy ?? body.accuracyM;
  let branchId = body.branch_id ?? body.branchId;

  if (lat === undefined || lng === undefined) {
    throw new BadRequestError("Latitude and longitude are required");
  }

  // If branchId is not provided, try to find the user's primary branch
  if (!branchId) {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { primaryBranchId: true },
    });
    if (!user?.primaryBranchId) {
      throw new BadRequestError("Branch ID is required");
    }
    branchId = user.primaryBranchId;
  }

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  const svc = new AttendanceSyncService(prisma);
  const result = await svc.applyClockEvent(
    {
      userId: req.userId,
      branchId: branchId,
      type: body.type,
      latitude: lat,
      longitude: lng,
      accuracyM: accuracy,
      clientTimestamp: body.clientTimestamp ? new Date(body.clientTimestamp) : new Date(),
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

export const getTodayAttendance = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) {
    throw new UnauthorizedError("User not provisioned");
  }

  const today = new Date();
  const workDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const session = await prisma.attendanceSession.findUnique({
    where: { userId_workDate: { userId: req.userId, workDate } },
    include: {
      events: { orderBy: { clientTimestamp: "asc" } },
      branch: true,
    },
  });

  if (!session) {
    res.json(null);
    return;
  }

  // Calculate total hours if closed
  let totalHours = 0;
  const clockIn = session.events.find(e => e.type === "CLOCK_IN" && e.accepted);
  const clockOut = session.events.find(e => e.type === "CLOCK_OUT" && e.accepted);

  if (clockIn && clockOut) {
    totalHours = (clockOut.clientTimestamp.getTime() - clockIn.clientTimestamp.getTime()) / (1000 * 60 * 60);
  }

  // Check if late (after 9:00 AM)
  const isLate = clockIn ? (clockIn.clientTimestamp.getUTCHours() > 9 || (clockIn.clientTimestamp.getUTCHours() === 9 && clockIn.clientTimestamp.getUTCMinutes() > 0)) : false;

  res.json({
    ...session,
    totalHours: totalHours.toFixed(2),
    isLate,
    clockIn: clockIn?.clientTimestamp,
    clockOut: clockOut?.clientTimestamp,
  });
});

export const checkIn = asyncHandler(async (req: Request, res: Response) => {
  return handleClock(req, res, "CLOCK_IN");
});

export const checkOut = asyncHandler(async (req: Request, res: Response) => {
  return handleClock(req, res, "CLOCK_OUT");
});

export const postClock = asyncHandler(async (req: Request, res: Response) => {
  return handleClock(req, res, req.body.type);
});

export const getAttendanceHistory = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) {
    throw new UnauthorizedError("User not provisioned");
  }

  const history = await prisma.attendanceSession.findMany({
    where: { userId: req.userId },
    orderBy: { workDate: "desc" },
    take: 30,
    include: {
      events: { orderBy: { clientTimestamp: "asc" } },
      branch: true,
    },
  });

  const formattedHistory = history.map(session => {
    const clockIn = session.events.find(e => e.type === "CLOCK_IN" && e.accepted);
    const clockOut = session.events.find(e => e.type === "CLOCK_OUT" && e.accepted);
    let totalHours = 0;
    if (clockIn && clockOut) {
      totalHours = (clockOut.clientTimestamp.getTime() - clockIn.clientTimestamp.getTime()) / (1000 * 60 * 60);
    }
    const isLate = clockIn ? (clockIn.clientTimestamp.getUTCHours() > 9 || (clockIn.clientTimestamp.getUTCHours() === 9 && clockIn.clientTimestamp.getUTCMinutes() > 0)) : false;

    return {
      date: session.workDate.toISOString().split("T")[0],
      clockIn: clockIn?.clientTimestamp,
      clockOut: clockOut?.clientTimestamp,
      totalHours: totalHours.toFixed(2),
      isLate,
      status: session.status,
    };
  });

  res.json(formattedHistory);
});

export const requestCorrection = asyncHandler(async (req: Request, res: Response) => {
  const body = correctionBody.parse(req.body);
  if (!req.userId) {
    throw new UnauthorizedError("User not provisioned");
  }

  const workDate = new Date(body.missed_date);

  // Use Workflow engine for corrections
  const workflow = await prisma.workflowInstance.create({
    data: {
      module: "HR_ATTENDANCE_ADJUSTMENT",
      entityType: "AttendanceAdjustment",
      entityId: crypto.randomUUID(), // Placeholder for now, will update after creating adjustment
      currentState: "SUBMITTED",
      ownedByUserId: req.userId,
    },
  });

  const adjustment = await (prisma as any).attendanceAdjustment.create({
    data: {
      userId: req.userId,
      workDate,
      reason: body.reason,
      requestedChanges: {}, // Frontend can specify details if needed
      workflowInstanceId: workflow.id,
    },
  });

  // Update workflow with real entityId
  await prisma.workflowInstance.update({
    where: { id: workflow.id },
    data: { entityId: adjustment.id },
  });

  res.status(201).json(adjustment);
});

export const getMyCorrections = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) {
    throw new UnauthorizedError("User not provisioned");
  }

  const corrections = await (prisma as any).attendanceAdjustment.findMany({
    where: { userId: req.userId },
    include: {
      workflowInstance: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const formatted = corrections.map((c: any) => ({
    id: c.id,
    missed_date: c.workDate.toISOString().split("T")[0],
    reason: c.reason,
    status: c.workflowInstance.currentState,
    createdAt: c.createdAt,
  }));

  res.json(formatted);
});

export const postClockSyncBatch = asyncHandler(async (req: Request, res: Response) => {
  const batch = syncBody.parse(req.body);
  if (!req.userId) {
    throw new UnauthorizedError("User not provisioned");
  }
  const svc = new AttendanceSyncService(prisma);
  const results = [];
  for (const item of batch) {
    const lat = item.lat ?? item.latitude;
    const lng = item.lng ?? item.longitude;
    const accuracy = item.accuracy ?? item.accuracyM;
    let branchId = item.branch_id ?? item.branchId;

    if (lat === undefined || lng === undefined) continue;

    if (!branchId) {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { primaryBranchId: true },
      });
      branchId = user?.primaryBranchId || "";
    }
    if (!branchId) continue;

    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const r = await svc.applyClockEvent(
      {
        userId: req.userId,
        branchId: branchId,
        type: item.type,
        latitude: lat,
        longitude: lng,
        accuracyM: accuracy,
        clientTimestamp: item.clientTimestamp ? new Date(item.clientTimestamp) : new Date(),
        idempotencyKey: item.idempotencyKey,
        source: item.source,
      },
      branch,
    );
    results.push(r);
  }
  res.status(200).json({ results });
});

export const getClockEventsForUser = asyncHandler(async (req: Request, res: Response) => {
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
});
