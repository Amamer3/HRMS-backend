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
  branch_id: z.string().uuid().optional().nullable(),
  type: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  accuracyM: z.coerce.number().optional().nullable(),
  accuracy: z.coerce.number().optional().nullable(),
  clientTimestamp: z.string().datetime().optional(),
  idempotencyKey: z.string().uuid().optional().nullable(),
  source: z.enum(["ONLINE", "OFFLINE_SYNC"]).default("ONLINE"),
});

const syncBody = z.array(clockBody).max(50);

const correctionBody = z.object({
  missed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  reason: z.string().min(1).max(1000),
});

/** Returns true when the clock-in time is considered late given the branch's workday config. */
function isLateForBranch(
  clockInTimestamp: Date,
  workdayStartLocal: string,
  lateGraceMinutes: number,
): { isLate: boolean; minutesLate: number } {
  const [startHour, startMin] = workdayStartLocal.split(":").map(Number);
  const scheduledStart = new Date(clockInTimestamp);
  scheduledStart.setUTCHours(startHour, startMin, 0, 0);

  const diffMs = clockInTimestamp.getTime() - scheduledStart.getTime();
  if (diffMs <= 0) return { isLate: false, minutesLate: 0 };

  const minutesLate = Math.floor(diffMs / (1000 * 60));
  return { isLate: minutesLate > lateGraceMinutes, minutesLate };
}

async function handleClock(req: Request, res: Response, type: "CLOCK_IN" | "CLOCK_OUT") {
  req.body.type = type;
  const body = clockBody.parse(req.body);
  if (!req.userId) throw new UnauthorizedError("User not provisioned");

  const lat = body.lat ?? body.latitude;
  const lng = body.lng ?? body.longitude;
  const accuracy = body.accuracy ?? body.accuracyM;
  let branchId = body.branch_id ?? body.branchId;

  if (lat === undefined || lng === undefined) {
    throw new BadRequestError("Latitude and longitude are required");
  }

  if (!branchId) {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { primaryBranchId: true },
    });
    if (!user?.primaryBranchId) throw new BadRequestError("Branch ID is required");
    branchId = user.primaryBranchId;
  }

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  const svc = new AttendanceSyncService(prisma);
  const result = await svc.applyClockEvent(
    {
      userId: req.userId,
      branchId,
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
  if (!req.userId) throw new UnauthorizedError("User not provisioned");

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

  const clockIn = session.events.find(e => e.type === "CLOCK_IN" && e.accepted);
  const clockOut = session.events.find(e => e.type === "CLOCK_OUT" && e.accepted);

  let totalHours = 0;
  if (clockIn && clockOut) {
    totalHours = (clockOut.clientTimestamp.getTime() - clockIn.clientTimestamp.getTime()) / (1000 * 60 * 60);
  }

  const { isLate, minutesLate } = clockIn
    ? isLateForBranch(
        clockIn.clientTimestamp,
        session.branch.workdayStartLocal,
        session.branch.lateGraceMinutes,
      )
    : { isLate: false, minutesLate: 0 };

  res.json({
    ...session,
    totalHours: totalHours.toFixed(2),
    isLate,
    minutesLate,
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
  if (!req.userId) throw new UnauthorizedError("User not provisioned");

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const skip = (page - 1) * limit;

  const [total, history] = await Promise.all([
    prisma.attendanceSession.count({ where: { userId: req.userId } }),
    prisma.attendanceSession.findMany({
      where: { userId: req.userId },
      orderBy: { workDate: "desc" },
      skip,
      take: limit,
      include: {
        events: { orderBy: { clientTimestamp: "asc" } },
        branch: true,
      },
    }),
  ]);

  const items = history.map(session => {
    const clockIn = session.events.find(e => e.type === "CLOCK_IN" && e.accepted);
    const clockOut = session.events.find(e => e.type === "CLOCK_OUT" && e.accepted);

    let totalHours = 0;
    if (clockIn && clockOut) {
      totalHours = (clockOut.clientTimestamp.getTime() - clockIn.clientTimestamp.getTime()) / (1000 * 60 * 60);
    }

    const { isLate, minutesLate } = clockIn
      ? isLateForBranch(
          clockIn.clientTimestamp,
          session.branch.workdayStartLocal,
          session.branch.lateGraceMinutes,
        )
      : { isLate: false, minutesLate: 0 };

    return {
      date: session.workDate.toISOString().split("T")[0],
      clockIn: clockIn?.clientTimestamp,
      clockOut: clockOut?.clientTimestamp,
      totalHours: totalHours.toFixed(2),
      isLate,
      minutesLate,
      status: session.status,
      session,
    };
  });

  res.json({ items, total, page, limit });
});

export const requestCorrection = asyncHandler(async (req: Request, res: Response) => {
  const body = correctionBody.parse(req.body);
  if (!req.userId) throw new UnauthorizedError("User not provisioned");

  const workDate = new Date(body.missed_date);

  const workflow = await prisma.workflowInstance.create({
    data: {
      module: "HR_ATTENDANCE_ADJUSTMENT",
      entityType: "AttendanceAdjustment",
      entityId: crypto.randomUUID(),
      currentState: "SUBMITTED",
      ownedByUserId: req.userId,
    },
  });

  const adjustment = await prisma.attendanceAdjustment.create({
    data: {
      userId: req.userId,
      workDate,
      reason: body.reason,
      requestedChanges: {},
      workflowInstanceId: workflow.id,
    },
  });

  await prisma.workflowInstance.update({
    where: { id: workflow.id },
    data: { entityId: adjustment.id },
  });

  res.status(201).json(adjustment);
});

export const getMyCorrections = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) throw new UnauthorizedError("User not provisioned");

  const corrections = await prisma.attendanceAdjustment.findMany({
    where: { userId: req.userId },
    include: { workflowInstance: true },
    orderBy: { createdAt: "desc" },
  });

  const formatted = corrections.map(c => ({
    id: c.id,
    missed_date: c.workDate.toISOString().split("T")[0],
    reason: c.reason,
    status: c.workflowInstance.currentState,
    createdAt: c.createdAt,
    adjustment: c,
  }));

  res.json(formatted);
});

export const postClockSyncBatch = asyncHandler(async (req: Request, res: Response) => {
  const batch = syncBody.parse(req.body);
  if (!req.userId) throw new UnauthorizedError("User not provisioned");

  const svc = new AttendanceSyncService(prisma);
  const results = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const lat = item.lat ?? item.latitude;
    const lng = item.lng ?? item.longitude;
    const accuracy = item.accuracy ?? item.accuracyM;
    let branchId = item.branch_id ?? item.branchId;

    if (lat === undefined || lng === undefined) {
      skipped.push({ index: i, reason: "Missing latitude or longitude" });
      continue;
    }

    if (!branchId) {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { primaryBranchId: true },
      });
      branchId = user?.primaryBranchId ?? null;
    }

    if (!branchId) {
      skipped.push({ index: i, reason: "No branch ID and no primary branch on user" });
      continue;
    }

    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const r = await svc.applyClockEvent(
      {
        userId: req.userId,
        branchId,
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

  res.status(200).json({ results, skipped });
});

export const getClockEventsForUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const items = await prisma.clockEvent.findMany({
    where: { userId },
    orderBy: { serverTimestamp: "desc" },
  });
  res.json({ items });
});
