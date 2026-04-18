import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { WorkflowEngine } from "../services/workflowEngine.js";
import { appendAuditLog } from "../middleware/auditMiddleware.js";
import { NotificationService } from "../services/notification/NotificationService.js";

const createLeave = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  workingDays: z.number().positive(),
  reason: z.string().optional(),
});

/**
 * Example flow: create WorkflowInstance + LeaveRequest in DRAFT, transition to SUBMITTED, notify approvers.
 */
export async function postLeaveRequest(req: Request, res: Response) {
  const body = createLeave.parse(req.body);
  if (!req.userId) {
    res.status(400).json({ error: "user_not_provisioned" });
    return;
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
}

export async function listMyLeaves(req: Request, res: Response) {
  if (!req.userId) {
    res.status(400).json({ error: "user_not_provisioned" });
    return;
  }
  const items = await prisma.leaveRequest.findMany({
    where: { userId: req.userId },
    include: { leaveType: true, workflowInstance: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ items });
}
