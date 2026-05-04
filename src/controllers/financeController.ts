import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

const financeRequests = new Map<string, any>();

export async function getFinanceRequests(req: Request, res: Response) {
  const { status } = req.query;
  let all = Array.from(financeRequests.values());
  if (status) all = all.filter(f => Array.isArray(status) ? status.includes(f.status) : f.status === status);
  res.json(all);
}

export async function createFinanceRequest(req: Request, res: Response) {
  const id = randomUUID();
  const request = {
    id,
    employeeId: (req as any).user?.id,
    ...req.body,
    status: "PENDING",
    createdAt: new Date(),
  };
  financeRequests.set(id, request);
  res.status(201).json(request);
}

export async function approveFinanceRequest(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const request = financeRequests.get(id);
  if (!request) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  request.status = "APPROVED";
  res.json(request);
}

export async function rejectFinanceRequest(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const request = financeRequests.get(id);
  if (!request) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  request.status = "REJECTED";
  res.json(request);
}
