import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError } from "../lib/errors.js";

const tickets = new Map<string, any>();
const queues = new Map<string, any>();

// Initialize default queues
queues.set("general", { id: "general", name: "General Support", description: "General IT support", activeTickets: 5 });
queues.set("network", { id: "network", name: "Network", description: "Network issues", activeTickets: 2 });
queues.set("hardware", { id: "hardware", name: "Hardware", description: "Hardware support", activeTickets: 3 });

export const getTickets = asyncHandler(async (req: Request, res: Response) => {
  const { status, priority } = req.query;
  let all = Array.from(tickets.values());
  if (status) all = all.filter(t => t.status === (Array.isArray(status) ? status[0] : status));
  if (priority) all = all.filter(t => t.priority === (Array.isArray(priority) ? priority[0] : priority));
  res.json(all);
});

export const createTicket = asyncHandler(async (req: Request, res: Response) => {
  const id = randomUUID();
  const ticket = {
    id,
    createdBy: req.userId,
    ...req.body,
    status: "OPEN",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  tickets.set(id, ticket);
  res.status(201).json(ticket);
});

export const updateTicket = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const ticket = tickets.get(id);
  if (!ticket) {
    throw new NotFoundError("Ticket not found");
  }
  Object.assign(ticket, req.body, { updatedAt: new Date() });
  res.json(ticket);
});

export const deleteTicket = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  if (!tickets.has(id)) {
    throw new NotFoundError("Ticket not found");
  }
  tickets.delete(id);
  res.status(204).send();
});

export const getQueues = asyncHandler(async (_req: Request, res: Response) => {
  res.json(Array.from(queues.values()));
});
