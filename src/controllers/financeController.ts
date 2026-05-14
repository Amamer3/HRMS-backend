import { Request, Response } from "express";
import { z } from "zod";
import { WorkflowState } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";
import { WorkflowEngine } from "../services/workflowEngine.js";

const createFinanceRequestBody = z.object({
  amount: z.coerce.number().positive("Amount must be positive"),
  purpose: z.string().min(1, "Purpose is required").max(1000),
  currency: z.string().length(3).default("GHS"),
});

function toWorkflowState(raw: unknown): WorkflowState | undefined {
  const v = String(raw).toUpperCase();
  return (Object.values(WorkflowState) as string[]).includes(v) ? (v as WorkflowState) : undefined;
}

export const getFinanceRequests = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  let statusFilter: { in: WorkflowState[] } | WorkflowState | undefined;
  if (status) {
    if (Array.isArray(status)) {
      const states = status.map(toWorkflowState).filter((s): s is WorkflowState => s !== undefined);
      statusFilter = states.length > 0 ? { in: states } : undefined;
    } else {
      statusFilter = toWorkflowState(status);
    }
  }

  const where = statusFilter
    ? { workflowInstance: { currentState: statusFilter } }
    : undefined;

  const [total, items] = await Promise.all([
    prisma.financeRequest.count({ where }),
    prisma.financeRequest.findMany({
      where,
      include: { requester: true, workflowInstance: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  res.json({ items, total, page, limit });
});

export const createFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { amount, purpose, currency } = createFinanceRequestBody.parse(req.body);

  const workflow = await prisma.workflowInstance.create({
    data: {
      module: "FINANCE_REQUEST",
      entityType: "FinanceRequest",
      entityId: "00000000-0000-0000-0000-000000000000",
      currentState: "SUBMITTED",
      ownedByUserId: req.userId,
    },
  });

  const request = await prisma.financeRequest.create({
    data: {
      amount,
      purpose,
      currency,
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
  const comment: string = req.body?.comment ?? "Approved by finance admin";

  const finance = await prisma.financeRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!finance) throw new NotFoundError("Finance request not found");

  const currentState = finance.workflowInstance.currentState;

  if (currentState === "COMPLETED" || currentState === "CLOSED") {
    return res.json({ message: "Finance request already approved" });
  }

  const engine = new WorkflowEngine(prisma);

  // FINANCE_REQUEST: PENDING_APPROVAL → IN_PROGRESS → COMPLETED
  if (currentState === "PENDING_APPROVAL") {
    await engine.transition(req, { workflowId: finance.workflowInstanceId, to: "IN_PROGRESS", comment });
    await engine.transition(req, { workflowId: finance.workflowInstanceId, to: "COMPLETED", comment });
    return res.json({ message: "Finance request approved" });
  }

  if (currentState === "IN_PROGRESS") {
    await engine.transition(req, { workflowId: finance.workflowInstanceId, to: "COMPLETED", comment });
    return res.json({ message: "Finance request approved" });
  }

  throw new ConflictError(`Finance request cannot be approved from ${currentState} state`);
});

export const rejectFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const comment: string = req.body?.comment ?? "Rejected by finance admin";

  const finance = await prisma.financeRequest.findUnique({
    where: { id },
    include: { workflowInstance: true },
  });

  if (!finance) throw new NotFoundError("Finance request not found");

  const currentState = finance.workflowInstance.currentState;

  if (currentState === "REJECTED" || currentState === "CANCELLED") {
    return res.json({ message: "Finance request already rejected" });
  }

  if (currentState !== "PENDING_APPROVAL") {
    throw new ConflictError(`Finance request cannot be rejected from ${currentState} state`);
  }

  const engine = new WorkflowEngine(prisma);
  await engine.transition(req, { workflowId: finance.workflowInstanceId, to: "REJECTED", comment });

  return res.json({ message: "Finance request rejected" });
});
