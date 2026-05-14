import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { WorkflowEngine } from "../services/workflowEngine.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { Permission, roleHasPermission } from "../config/permissions.js";
import { debitLeaveBalanceOnApproval } from "../services/leaveBalanceService.js";

/**
 * Admin: Get all leave requests with filters.
 */
export const getAllLeaves = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, status, leaveTypeId } = req.query;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const roles = req.appRoles || [];
  const canReadAll = roles.some(role => roleHasPermission(role, Permission.HR_LEAVE_READ));

  const targetUserId = canReadAll
    ? (employeeId ? (employeeId as string) : undefined)
    : req.userId;

  const where = {
    ...(targetUserId && { userId: targetUserId }),
    ...(leaveTypeId && { leaveTypeId: leaveTypeId as string }),
    ...(status && {
      workflowInstance: {
        currentState: String(status).toUpperCase() as any,
      },
    }),
  };

  const [total, items] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      include: { user: true, leaveType: true, workflowInstance: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  res.json({ items, total, page, limit });
});

/**
 * Admin: Get pending leaves for dashboard.
 */
export const getPendingDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const items = await prisma.leaveRequest.findMany({
    where: {
      workflowInstance: {
        currentState: "PENDING_APPROVAL",
      },
    },
    include: {
      user: true,
      leaveType: true,
      workflowInstance: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ items });
});

/**
 * Admin/Manager: Approve a leave request.
 */
export const approveLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const comment =
    typeof req.body?.comment === "string" && req.body.comment.trim().length > 0
      ? req.body.comment
      : undefined;
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!leave) throw new NotFoundError("Leave request not found");

  const currentState = leave.workflowInstance.currentState;
  const engine = new WorkflowEngine(prisma);

  if (currentState === "COMPLETED" || currentState === "CLOSED") {
    return res.json({ message: "Leave already approved" });
  }

  if (currentState === "PENDING_APPROVAL") {
    await engine.transition(req, {
      workflowId: leave.workflowInstanceId,
      to: "IN_PROGRESS",
    });
    await engine.transition(req, {
      workflowId: leave.workflowInstanceId,
      to: "COMPLETED",
      comment,
    });
    await debitLeaveBalanceOnApproval(prisma, leave.id);
    return res.json({ message: "Leave approved" });
  }

  if (currentState === "IN_PROGRESS") {
    await engine.transition(req, {
      workflowId: leave.workflowInstanceId,
      to: "COMPLETED",
      comment,
    });
    await debitLeaveBalanceOnApproval(prisma, leave.id);
    return res.json({ message: "Leave approved" });
  }

  throw new ConflictError(`Leave cannot be approved from ${currentState} state`);
});

/**
 * Admin/Manager: Reject a leave request.
 */
export const rejectLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const comment =
    typeof req.body?.comment === "string" && req.body.comment.trim().length > 0
      ? req.body.comment
      : "Rejected by admin";
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!leave) throw new NotFoundError("Leave request not found");

  const currentState = leave.workflowInstance.currentState;
  if (currentState !== "PENDING_APPROVAL") {
    throw new ConflictError(`Leave cannot be rejected from ${currentState} state`);
  }

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: leave.workflowInstanceId,
    to: "REJECTED",
    comment,
  });

  res.json({ message: "Leave rejected" });
});

/**
 * Admin/Manager: Return a leave request for clarification.
 */
export const returnLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const comment =
    typeof req.body?.comment === "string" && req.body.comment.trim().length > 0
      ? req.body.comment
      : "Returned for clarification";
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!leave) throw new NotFoundError("Leave request not found");

  const currentState = leave.workflowInstance.currentState;
  if (!["PENDING_APPROVAL", "IN_PROGRESS", "PENDING_REQUESTER_CONFIRMATION"].includes(currentState)) {
    throw new ConflictError(`Leave cannot be returned from ${currentState} state`);
  }

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: leave.workflowInstanceId,
    to: "RETURNED",
    comment,
  });

  res.json({ message: "Leave returned" });
});

export const updateLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { startDate, endDate, workingDays, reason } = req.body;

  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });
  if (!leave) throw new NotFoundError("Leave request not found");

  const roles = req.appRoles ?? [];
  const canManageAll = roles.some((r) => roleHasPermission(r, Permission.HR_LEAVE_WRITE));
  if (!canManageAll && leave.userId !== req.userId) {
    throw new ForbiddenError("You can only modify your own leave requests");
  }

  const editableStates = ["DRAFT", "RETURNED"];
  if (!editableStates.includes(leave.workflowInstance.currentState)) {
    throw new ConflictError(`Leave cannot be edited in ${leave.workflowInstance.currentState} state`);
  }

  const parsedStart = startDate ? new Date(startDate) : leave.startDate;
  const parsedEnd = endDate ? new Date(endDate) : leave.endDate;
  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    throw new BadRequestError("Invalid date format");
  }
  if (parsedStart > parsedEnd) {
    throw new BadRequestError("Start date must be on or before end date");
  }

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: {
      ...(startDate && { startDate: parsedStart }),
      ...(endDate && { endDate: parsedEnd }),
      ...(workingDays !== undefined && { workingDays }),
      ...(reason !== undefined && { reason }),
    },
  });

  res.json({ leave: updated });
});

export const deleteLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });
  if (!leave) throw new NotFoundError("Leave request not found");

  if (leave.workflowInstance.currentState !== "DRAFT") {
    throw new ConflictError("Only draft leave requests can be deleted");
  }

  await prisma.leaveRequest.delete({ where: { id } });
  res.status(204).send();
});

export const submitLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!leave) throw new NotFoundError("Leave request not found");

  const roles = req.appRoles ?? [];
  const canManageAll = roles.some((r) => roleHasPermission(r, Permission.HR_LEAVE_WRITE));
  if (!canManageAll && leave.userId !== req.userId) {
    throw new ForbiddenError("You can only submit your own leave requests");
  }

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: leave.workflowInstanceId,
    to: "SUBMITTED",
  });

  res.json({ message: "Leave submitted" });
});
