import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { WorkflowEngine } from "../services/workflowEngine.js";

export const getAllAttendance = asyncHandler(async (req: Request, res: Response) => {
  const { date } = req.query;
  const workDate = date ? new Date(date as string) : new Date();
  workDate.setUTCHours(0, 0, 0, 0);

  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: { primaryBranch: true },
    orderBy: { displayName: "asc" },
  });

  const sessions = await prisma.attendanceSession.findMany({
    where: { workDate },
    include: {
      branch: true,
      events: { orderBy: { clientTimestamp: "asc" } },
    },
  });

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      startDate: { lte: workDate },
      endDate: { gte: workDate },
      workflowInstance: { currentState: "COMPLETED" },
    },
    include: { leaveType: true },
  });

  const sessionMap = new Map(sessions.map(s => [s.userId, s]));
  const leaveMap = new Map(leaves.map(l => [l.userId, l]));

  const formatted = users.map(user => {
    const session = sessionMap.get(user.id);
    const leave = leaveMap.get(user.id);
    const branch = session?.branch ?? user.primaryBranch;

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
        branch_name: branch?.name ?? "No Branch Assigned",
      };
    }

    const clockIn = session.events.find(e => e.type === "CLOCK_IN" && e.accepted);
    const clockOut = session.events.find(e => e.type === "CLOCK_OUT" && e.accepted);

    let minutesLate = 0;
    let isLate = false;

    if (clockIn && branch) {
      const [startHour, startMin] = branch.workdayStartLocal.split(":").map(Number);
      const scheduledStart = new Date(clockIn.clientTimestamp);
      scheduledStart.setUTCHours(startHour, startMin, 0, 0);

      if (clockIn.clientTimestamp > scheduledStart) {
        minutesLate = Math.floor(
          (clockIn.clientTimestamp.getTime() - scheduledStart.getTime()) / (1000 * 60),
        );
        if (minutesLate > branch.lateGraceMinutes) isLate = true;
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
      branch_name: branch?.name ?? "N/A",
    };
  });

  res.json(formatted);
});

export const getCorrections = asyncHandler(async (_req: Request, res: Response) => {
  const corrections = await prisma.attendanceAdjustment.findMany({
    include: {
      user: true,
      workflowInstance: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const formatted = corrections.map(c => ({
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
  const comment = typeof req.body?.comment === "string" ? req.body.comment : undefined;

  const adjustment = await prisma.attendanceAdjustment.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!adjustment) throw new NotFoundError("Correction not found");

  const currentState = adjustment.workflowInstance.currentState;
  if (currentState === "COMPLETED" || currentState === "CLOSED") {
    return res.json({ message: "Correction already approved" });
  }

  const engine = new WorkflowEngine(prisma);

  if (currentState === "SUBMITTED") {
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "PENDING_APPROVAL" });
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "IN_PROGRESS" });
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "COMPLETED", comment });
    return res.json({ message: "Correction approved", adjustment });
  }

  if (currentState === "PENDING_APPROVAL") {
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "IN_PROGRESS" });
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "COMPLETED", comment });
    return res.json({ message: "Correction approved", adjustment });
  }

  if (currentState === "IN_PROGRESS") {
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "COMPLETED", comment });
    return res.json({ message: "Correction approved", adjustment });
  }

  throw new ConflictError(`Correction cannot be approved from ${currentState} state`);
});

export const rejectCorrection = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const comment = typeof req.body?.comment === "string" ? req.body.comment : "Rejected";

  const adjustment = await prisma.attendanceAdjustment.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!adjustment) throw new NotFoundError("Correction not found");

  const currentState = adjustment.workflowInstance.currentState;
  if (currentState === "REJECTED" || currentState === "CANCELLED") {
    return res.json({ message: "Correction already rejected" });
  }

  const engine = new WorkflowEngine(prisma);

  if (currentState === "SUBMITTED") {
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "PENDING_APPROVAL" });
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "REJECTED", comment });
    return res.json({ message: "Correction rejected", adjustment });
  }

  if (currentState === "PENDING_APPROVAL") {
    await engine.transition(req, { workflowId: adjustment.workflowInstanceId, to: "REJECTED", comment });
    return res.json({ message: "Correction rejected", adjustment });
  }

  throw new ConflictError(`Correction cannot be rejected from ${currentState} state`);
});
