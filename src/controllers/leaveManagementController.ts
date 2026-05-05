import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { WorkflowEngine } from "../services/workflowEngine.js";
import { NotFoundError, UnauthorizedError } from "../lib/errors.js";
import { appendAuditLog } from "../middleware/auditMiddleware.js";
import { NotificationService } from "../services/notification/NotificationService.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const leaveSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  workingDays: z.coerce.number().positive(),
  reason: z.string().optional(),
});

/**
 * Admin: Get all leave requests with filters.
 */
export const getAllLeaves = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, status, leaveTypeId } = req.query;

  const items = await prisma.leaveRequest.findMany({
    where: {
      ...(employeeId && { userId: employeeId as string }),
      ...(leaveTypeId && { leaveTypeId: leaveTypeId as string }),
      ...(status && {
        workflowInstance: {
          currentState: String(status).toUpperCase() as any,
        },
      }),
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
export const approveLEave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!leave) throw new NotFoundError("Leave request not found");

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: leave.workflowInstanceId,
    to: "COMPLETED",
    comment: req.body.comment || "Approved by admin",
  });

  res.json({ message: "Leave approved" });
});

/**
 * Admin/Manager: Reject a leave request.
 */
export const rejectLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!leave) throw new NotFoundError("Leave request not found");

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: leave.workflowInstanceId,
    to: "REJECTED",
    comment: req.body.comment || "Rejected by admin",
  });

  res.json({ message: "Leave rejected" });
});

/**
 * Admin/Manager: Return a leave request for clarification.
 */
export const returnLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!leave) throw new NotFoundError("Leave request not found");

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: leave.workflowInstanceId,
    to: "RETURNED",
    comment: req.body.comment || "Returned for clarification",
  });

  res.json({ message: "Leave returned" });
});

/**
 * Create a new leave request.
 */
export const createLeave = asyncHandler(async (req: Request, res: Response) => {
  const body = leaveSchema.parse(req.body);
  if (!req.userId) {
    throw new UnauthorizedError("User not provisioned");
  }

  const wf = await prisma.workflowInstance.create({
    data: {
      module: "HR_LEAVE",
      entityType: "LeaveRequest",
      entityId: randomUUID(),
      currentState: "DRAFT",
      metadata: {},
    },
  });

  const leave = await prisma.leaveRequest.create({
    data: {
      userId: req.userId,
      leaveTypeId: body.leaveTypeId,
      workflowInstanceId: wf.id,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      workingDays: body.workingDays,
      reason: body.reason,
    },
  });

  await prisma.workflowInstance.update({
    where: { id: wf.id },
    data: { entityId: leave.id },
  });

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, { workflowId: wf.id, to: "SUBMITTED", comment: "Employee submitted" });
  await engine.transition(req, {
    workflowId: wf.id,
    to: "PENDING_APPROVAL",
    routingStep: "SUPERVISOR",
  });

  const notifier = NotificationService.createDefault();
  const channels = await notifier.channelsForRole("MANAGER", "WORKFLOW_APPROVAL_REQUIRED");
  await notifier.dispatchForEvent(
    {
      eventType: "WORKFLOW_APPROVAL_REQUIRED",
      payload: { title: "Leave approval", body: `Request ${leave.id}`, leaveRequestId: leave.id },
    },
    channels,
  );

  await appendAuditLog(req, {
    action: "leave.create",
    resourceType: "LeaveRequest",
    resourceId: leave.id,
    after: { workflowId: wf.id },
  });

  res.status(201).json({ leave, workflowId: wf.id });
});

export const updateLeave = asyncHandler(async (_req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented" });
});

export const deleteLeave = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
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

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: leave.workflowInstanceId,
    to: "SUBMITTED",
  });

  res.json({ message: "Leave submitted" });
});
