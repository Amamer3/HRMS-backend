import { Request, Response } from "express";
import { TicketPriority, WorkflowState } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";

function parseWorkflowState(raw: unknown): WorkflowState | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).toUpperCase();
  return (Object.values(WorkflowState) as string[]).includes(v)
    ? (v as WorkflowState)
    : undefined;
}

function parseTicketPriority(raw: unknown): TicketPriority | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).toUpperCase();
  return (Object.values(TicketPriority) as string[]).includes(v)
    ? (v as TicketPriority)
    : undefined;
}

export const getTickets = asyncHandler(async (req: Request, res: Response) => {
  const stateFilter = parseWorkflowState(req.query.status);
  const priorityFilter = parseTicketPriority(req.query.priority);

  const allTickets = await prisma.itTicket.findMany({
    where: {
      ...(stateFilter !== undefined && {
        workflowInstance: {
          currentState: stateFilter,
        },
      }),
      ...(priorityFilter !== undefined && {
        priority: priorityFilter,
      }),
    },
    include: {
      createdBy: true,
      assignee: true,
      workflowInstance: true,
      comments: {
        include: { author: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(allTickets);
});

export const createTicket = asyncHandler(async (req: Request, res: Response) => {
  const { title, description, priority } = req.body;
  
  const workflow = await prisma.workflowInstance.create({
    data: {
      module: "IT_TICKET",
      entityType: "ItTicket",
      entityId: "00000000-0000-0000-0000-000000000000", // Temp ID
      currentState: WorkflowState.OPEN,
      ownedByUserId: req.userId,
    },
  });

  const ticket = await prisma.itTicket.create({
    data: {
      title,
      description,
      priority: priority || "MEDIUM",
      createdById: req.userId!,
      workflowInstanceId: workflow.id,
    },
  });

  await prisma.workflowInstance.update({
    where: { id: workflow.id },
    data: { entityId: ticket.id },
  });

  res.status(201).json(ticket);
});

export const updateTicket = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const ticket = await prisma.itTicket.update({
    where: { id },
    data: req.body,
  });
  res.json(ticket);
});

export const deleteTicket = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  await prisma.itTicket.delete({ where: { id } });
  res.status(204).send();
});

export const getQueues = asyncHandler(async (_req: Request, res: Response) => {
  // Queues aren't in schema yet, returning static but could be metadata
  const queues = [
    { id: "general", name: "General Support", description: "General IT support", activeTickets: 5 },
    { id: "network", name: "Network", description: "Network issues", activeTickets: 2 },
    { id: "hardware", name: "Hardware", description: "Hardware support", activeTickets: 3 },
  ];
  res.json(queues);
});
