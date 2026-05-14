import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { BadRequestError } from "../lib/errors.js";

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const d = new Date(raw as string);
  return isNaN(d.getTime()) ? null : d;
}

export const getSummary = asyncHandler(async (_req: Request, res: Response) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const totalEmployees = await prisma.user.count({
    where: { isActive: true },
  });

  const presentToday = await prisma.attendanceSession.count({
    where: {
      workDate: today,
    },
  });

  const onLeaveToday = await prisma.leaveRequest.count({
    where: {
      startDate: { lte: today },
      endDate: { gte: today },
      workflowInstance: {
        currentState: "COMPLETED",
      },
    },
  });

  const absentToday = Math.max(0, totalEmployees - presentToday - onLeaveToday);

  res.json({
    totalEmployees,
    presentToday,
    absentToday,
    onLeaveToday,
  });
});

export const getAttendanceReport = asyncHandler(async (req: Request, res: Response) => {
  const { start_date, end_date } = req.query;

  if (start_date && !parseDate(start_date)) {
    throw new BadRequestError("Invalid start_date format. Use YYYY-MM-DD.");
  }
  if (end_date && !parseDate(end_date)) {
    throw new BadRequestError("Invalid end_date format. Use YYYY-MM-DD.");
  }

  const now = new Date();
  const start = parseDate(start_date) ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const end = parseDate(end_date) ?? now;

  if (start > end) {
    throw new BadRequestError("start_date must be on or before end_date");
  }

  const sessions = await prisma.attendanceSession.findMany({
    where: {
      workDate: {
        gte: start,
        lte: end,
      },
    },
    include: {
      branch: true,
      events: {
        orderBy: { clientTimestamp: "asc" },
      },
    },
  });

  const totalEmployees = await prisma.user.count({
    where: { isActive: true },
  });

  // Group by date
  const dailyStats: Record<string, { date: string; presentCount: number; lateCount: number; absentCount: number }> = {};

  // Initialize dailyStats for the range
  const curr = new Date(start);
  while (curr <= end) {
    const d = curr.toISOString().split("T")[0];
    dailyStats[d] = { date: d, presentCount: 0, lateCount: 0, absentCount: totalEmployees };
    curr.setDate(curr.getDate() + 1);
  }

  for (const session of sessions) {
    const d = session.workDate.toISOString().split("T")[0];
    if (dailyStats[d]) {
      dailyStats[d].presentCount++;
      dailyStats[d].absentCount--;

      const clockIn = session.events.find(e => e.type === "CLOCK_IN" && e.accepted);
      if (clockIn) {
        const [startHour, startMin] = session.branch.workdayStartLocal.split(":").map(Number);
        const checkInTime = clockIn.clientTimestamp;
        const scheduledStart = new Date(checkInTime);
        scheduledStart.setUTCHours(startHour, startMin, 0, 0);

        if (checkInTime > scheduledStart) {
          const minutesLate = (checkInTime.getTime() - scheduledStart.getTime()) / (1000 * 60);
          if (minutesLate > session.branch.lateGraceMinutes) {
            dailyStats[d].lateCount++;
          }
        }
      }
    }
  }

  res.json(Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date)));
});

export const getLeaveReport = asyncHandler(async (req: Request, res: Response) => {
  const { start_date, end_date } = req.query;

  if (start_date && !parseDate(start_date)) {
    throw new BadRequestError("Invalid start_date format. Use YYYY-MM-DD.");
  }
  if (end_date && !parseDate(end_date)) {
    throw new BadRequestError("Invalid end_date format. Use YYYY-MM-DD.");
  }

  const now = new Date();
  const start = parseDate(start_date) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const end = parseDate(end_date) ?? now;

  if (start > end) {
    throw new BadRequestError("start_date must be on or before end_date");
  }

  const requests = await prisma.leaveRequest.findMany({
    where: {
      startDate: { lte: end },
      endDate: { gte: start },
    },
    include: {
      user: { select: { id: true, displayName: true, email: true } },
      leaveType: { select: { id: true, name: true, code: true } },
      workflowInstance: { select: { currentState: true } },
    },
    orderBy: { startDate: "desc" },
  });

  res.json(requests);
});
