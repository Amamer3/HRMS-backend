import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

const tickets = new Map<string, any>();
const queues = new Map<string, any>();

// Initialize default queues
queues.set("general", { id: "general", name: "General Support", description: "General IT support", activeTickets: 5 });
queues.set("network", { id: "network", name: "Network", description: "Network issues", activeTickets: 2 });
queues.set("hardware", { id: "hardware", name: "Hardware", description: "Hardware support", activeTickets: 3 });

export async function getTickets(req: Request, res: Response) {
  const { status, priority } = req.query;
  let all = Array.from(tickets.values());
  if (status) all = all.filter(t => t.status === (Array.isArray(status) ? status[0] : status));
  if (priority) all = all.filter(t => t.priority === (Array.isArray(priority) ? priority[0] : priority));
  res.json(all);
}

export async function createTicket(req: Request, res: Response) {
  const id = randomUUID();
  const ticket = {
    id,
    createdBy: (req as any).user?.id,
    ...req.body,
    status: "OPEN",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  tickets.set(id, ticket);
  res.status(201).json(ticket);
}

export async function updateTicket(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const ticket = tickets.get(id);
  if (!ticket) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  Object.assign(ticket, req.body, { updatedAt: new Date() });
  res.json(ticket);
}

export async function deleteTicket(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  tickets.delete(id);
  res.status(204).send();
}

export async function getQueues(_req: Request, res: Response) {
  res.json(Array.from(queues.values()));
}
