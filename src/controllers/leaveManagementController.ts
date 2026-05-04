import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

// Mock data store
const leaveRequests = new Map<string, any>();

export async function getAllLeaves(req: Request, res: Response) {
  const { employee_id, status } = req.query;
  const leaves = Array.from(leaveRequests.values());
  
  let filtered = leaves;
  if (employee_id) {
    filtered = filtered.filter(l => l.employeeId === employee_id);
  } 
  if (status) {
    filtered = filtered.filter(l => l.status === status);
  }
  
  res.json(filtered);
}

export async function getPendingDashboard(_req: Request, res: Response) {
  const leaves = Array.from(leaveRequests.values());
  const pending = leaves.filter(l => l.status === "PENDING");
  res.json(pending);
}

export async function createLeave(req: Request, res: Response) {
  const { leaveTypeId, startDate, endDate, workingDays, reason } = req.body;
  const id = randomUUID();
  
  const leave = {
    id,
    employeeId: (req as any).user?.id,
    leaveTypeId,
    startDate,
    endDate,
    workingDays,
    reason,
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  leaveRequests.set(id, leave);
  res.status(201).json({ leave, workflowId: randomUUID() });
}

export async function updateLeave(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const leave = leaveRequests.get(id);
  
  if (!leave) {
    res.status(404).json({ error: "Leave not found" });
    return;
  }
  
  Object.assign(leave, req.body, { updatedAt: new Date() });
  res.json(leave);
}

export async function deleteLeave(req: Request, res: Response) {
  const id = req.params.id as string;
  leaveRequests.delete(id);
  res.status(204).send();
}

export async function approveLEave(req: Request, res: Response) {
  const id = req.params.id as string;
  const leave = leaveRequests.get(id);
  
  if (!leave) {
    res.status(404).json({ error: "Leave not found" });
    return;
  }
  
  leave.status = "APPROVED";
  leave.updatedAt = new Date();
  res.json(leave);
}

export async function rejectLeave(req: Request, res: Response) {
  const id = req.params.id as string;
  const leave = leaveRequests.get(id);
  
  if (!leave) {
    res.status(404).json({ error: "Leave not found" });
    return;
  }
  
  leave.status = "REJECTED";
  leave.updatedAt = new Date();
  res.json(leave);
}

export async function returnLeave(req: Request, res: Response) {
  const id = req.params.id as string;
  const leave = leaveRequests.get(id);
  
  if (!leave) {
    res.status(404).json({ error: "Leave not found" });
    return;
  }
  
  leave.status = "RETURNED";
  leave.updatedAt = new Date();
  res.json(leave);
}

export async function submitLeave(req: Request, res: Response) {
  const id = req.params.id as string;
  const leave = leaveRequests.get(id);
  
  if (!leave) {
    res.status(404).json({ error: "Leave not found" });
    return;
  }
  
  leave.status = "SUBMITTED";
  leave.updatedAt = new Date();
  res.json(leave);
}
