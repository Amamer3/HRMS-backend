import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError } from "../lib/errors.js";

export const getAllAttendance = asyncHandler(async (req: Request, res: Response) => {
  const { date } = req.query;
  const workDate = date ? new Date(date as string) : new Date();
  workDate.setUTCHours(0, 0, 0, 0);

  // Fetch all active users to ensure everyone is listed
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      primaryBranch: true,
    },
    orderBy: { displayName: "asc" },
  });

  // Fetch all attendance sessions for the target date
  const sessions = await prisma.attendanceSession.findMany({
    where: {
      workDate,
    },
    include: {
      branch: true,
      events: {
        orderBy: { clientTimestamp: "asc" },
      },
    },
  });

  // Fetch approved leave requests for the target date
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      startDate: { lte: workDate },
      endDate: { gte: workDate },
      workflowInstance: {
        currentState: "COMPLETED",
      },
    },
    include: {
      leaveType: true,
    },
  });

  // Map sessions and leaves by userId for quick lookup
  const sessionMap = new Map(sessions.map((s) => [s.userId, s]));
  const leaveMap = new Map(leaves.map((l) => [l.userId, l]));

  const formatted = users.map((user) => {
    const session = sessionMap.get(user.id);
    const leave = leaveMap.get(user.id);
    const branch = session?.branch || user.primaryBranch;

    if (!session) {
      return {
        id: null,
        employee_name: user.displayName,
        employee_email: user.email,
        check_in_time: null,
        check_out_time: null,
        status: leave ? `ON_LEAVE (${leave.leaveType.name})` : "ABSENT",
        is_late: false,
        minutes_late: 0,
        geofence_status: "outside",
        branch_name: branch?.name || "No Branch Assigned",
      };
    }

    const clockIn = session.events.find((e) => e.type === "CLOCK_IN" && e.accepted);
    const clockOut = session.events.find((e) => e.type === "CLOCK_OUT" && e.accepted);

    let minutesLate = 0;
    let isLate = false;

    if (clockIn && branch) {
      const [startHour, startMin] = branch.workdayStartLocal.split(":").map(Number);
      const checkInTime = clockIn.clientTimestamp;
      const scheduledStart = new Date(checkInTime);
      scheduledStart.setUTCHours(startHour, startMin, 0, 0);

      if (checkInTime > scheduledStart) {
        minutesLate = Math.floor((checkInTime.getTime() - scheduledStart.getTime()) / (1000 * 60));
        if (minutesLate > branch.lateGraceMinutes) {
          isLate = true;
        }
      }
    }

    return {
      id: session.id,
      employee_name: user.displayName,
      employee_email: user.email,
      check_in_time: clockIn?.clientTimestamp,
      check_out_time: clockOut?.clientTimestamp,
      status: session.status,
      is_late: isLate,
      minutes_late: minutesLate,
      geofence_status: clockIn?.accepted ? "inside" : "outside",
      branch_name: branch?.name || "N/A",
    };
  });

  res.json(formatted);
});

export const getCorrections = asyncHandler(async (_req: Request, res: Response) => {
  const corrections = await (prisma as any).attendanceAdjustment.findMany({
    include: {
      user: true,
      workflowInstance: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const formatted = corrections.map((c: any) => ({
    id: c.id,
    employee_name: c.user.displayName,
    employee_email: c.user.email,
    missed_date: c.workDate.toISOString().split("T")[0],
    reason: c.reason,
    status: c.workflowInstance.currentState,
    createdAt: c.createdAt,
    user: c.user,
    workflow: c.workflowInstance,
  }));

  res.json(formatted);
});

export const approveCorrection = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  
  const adjustment = await (prisma as any).attendanceAdjustment.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!adjustment) {
    throw new NotFoundError("Correction not found");
  }

  // Update workflow state
  await prisma.workflowInstance.update({
    where: { id: adjustment.workflowInstanceId },
    data: { currentState: "COMPLETED" },
  });

  res.json({ message: "Correction approved", adjustment });
});

export const rejectCorrection = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  const adjustment = await (prisma as any).attendanceAdjustment.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!adjustment) {
    throw new NotFoundError("Correction not found");
  }

  // Update workflow state
  await prisma.workflowInstance.update({
    where: { id: adjustment.workflowInstanceId },
    data: { currentState: "REJECTED" },
  });

  res.json({ message: "Correction rejected", adjustment });
});
