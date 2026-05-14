import { Request, Response } from "express";
import { z } from "zod";
import { TicketPriority, WorkflowState } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";
import { Permission, roleHasPermission } from "../config/permissions.js";

const createTicketBody = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().min(1, "Description is required").max(5000),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.MEDIUM),
});

const updateTicketBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assigneeId: z.string().uuid().optional(),
});

function parseWorkflowState(raw: unknown): WorkflowState | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).toUpperCase();
  return (Object.values(WorkflowState) as string[]).includes(v) ? (v as WorkflowState) : undefined;
}

function parseTicketPriority(raw: unknown): TicketPriority | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).toUpperCase();
  return (Object.values(TicketPriority) as string[]).includes(v) ? (v as TicketPriority) : undefined;
}

export const getTickets = asyncHandler(async (req: Request, res: Response) => {
  const stateFilter = parseWorkflowState(req.query.status);
  const priorityFilter = parseTicketPriority(req.query.priority);
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const where = {
    ...(stateFilter !== undefined && { workflowInstance: { currentState: stateFilter } }),
    ...(priorityFilter !== undefined && { priority: priorityFilter }),
  };

  const [total, items] = await Promise.all([
    prisma.itTicket.count({ where }),
    prisma.itTicket.findMany({
      where,
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
      skip,
      take: limit,
    }),
  ]);

  res.json({ items, total, page, limit });
});

export const createTicket = asyncHandler(async (req: Request, res: Response) => {
  const { title, description, priority } = createTicketBody.parse(req.body);

  const workflow = await prisma.workflowInstance.create({
    data: {
      module: "IT_TICKET",
      entityType: "ItTicket",
      entityId: "00000000-0000-0000-0000-000000000000",
      currentState: WorkflowState.OPEN,
      ownedByUserId: req.userId,
    },
  });

  const ticket = await prisma.itTicket.create({
    data: {
      title,
      description,
      priority,
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
  const updates = updateTicketBody.parse(req.body);

  const ticket = await prisma.itTicket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError("Ticket not found");

  const roles = req.appRoles ?? [];
  const canManageAll = roles.some(r => roleHasPermission(r, Permission.SYSTEM_CONFIG) || r === "HR_ADMIN");
  if (!canManageAll && ticket.createdById !== req.userId) {
    throw new ForbiddenError("You can only modify your own tickets");
  }

  const updated = await prisma.itTicket.update({
    where: { id },
    data: updates,
  });

  res.json(updated);
});

export const deleteTicket = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  const roles = req.appRoles ?? [];

  // Employees are not permitted to delete tickets
  if (roles.includes("EMPLOYEE") && !roles.some(r => r === "HR_ADMIN" || r === "SUPER_ADMIN" || r === "MANAGER")) {
    throw new ForbiddenError("Employees cannot delete tickets");
  }

  const ticket = await prisma.itTicket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError("Ticket not found");

  await prisma.itTicket.delete({ where: { id } });
  res.status(204).send();
});

export const getQueues = asyncHandler(async (_req: Request, res: Response) => {
  // Queue counts derived from live ticket data
  const [general, network, hardware] = await Promise.all([
    prisma.itTicket.count({ where: { workflowInstance: { currentState: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] } } } }),
    prisma.itTicket.count({ where: { workflowInstance: { currentState: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] } } } }),
    prisma.itTicket.count({ where: { workflowInstance: { currentState: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] } } } }),
  ]);

  res.json([
    { id: "general", name: "General Support", description: "General IT support", activeTickets: general },
    { id: "network", name: "Network", description: "Network issues", activeTickets: network },
    { id: "hardware", name: "Hardware", description: "Hardware support", activeTickets: hardware },
  ]);
});
