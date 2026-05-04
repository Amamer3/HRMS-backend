import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError } from "../lib/errors.js";
import { WorkflowEngine } from "../services/workflowEngine.js";

export const getFinanceRequests = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query;
  
  const statusFilter = status 
    ? (Array.isArray(status) 
        ? { in: status.map(s => String(s).toUpperCase()) as any } 
        : String(status).toUpperCase() as any)
    : undefined;

  const allRequests = await prisma.financeRequest.findMany({
    where: {
      ...(statusFilter && {
        workflowInstance: {
          currentState: statusFilter,
        },
      }),
    },
    include: {
      requester: true,
      workflowInstance: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(allRequests);
});

export const createFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { amount, purpose, currency } = req.body;
  
  const workflow = await prisma.workflowInstance.create({
    data: {
      module: "FINANCE_REQUEST",
      entityType: "FinanceRequest",
      entityId: "00000000-0000-0000-0000-000000000000", // Placeholder
      currentState: "SUBMITTED",
      ownedByUserId: req.userId,
    },
  });

  const request = await prisma.financeRequest.create({
    data: {
      amount,
      purpose,
      currency: currency || "GHS",
      requesterId: req.userId!,
      workflowInstanceId: workflow.id,
    },
  });

  await prisma.workflowInstance.update({
    where: { id: workflow.id },
    data: { entityId: request.id },
  });

  res.status(201).json(request);
});

export const approveFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const finance = await prisma.financeRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!finance) throw new NotFoundError("Finance request not found");

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: finance.workflowInstanceId,
    to: "COMPLETED",
    comment: req.body.comment || "Approved by finance admin",
  });

  res.json({ message: "Finance request approved" });
});

export const rejectFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const finance = await prisma.financeRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!finance) throw new NotFoundError("Finance request not found");

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, {
    workflowId: finance.workflowInstanceId,
    to: "REJECTED",
    comment: req.body.comment || "Rejected by finance admin",
  });

  res.json({ message: "Finance request rejected" });
});
