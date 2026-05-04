import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

const employees = new Map<string, any>();
const branches = new Map<string, any>();

// Branches
export async function getBranches(_req: Request, res: Response) {
  res.json(Array.from(branches.values()));
}

export async function createBranch(req: Request, res: Response) {
  const id = randomUUID();
  const branch = { id, ...req.body, createdAt: new Date() };
  branches.set(id, branch);
  res.status(201).json(branch);
}

export async function updateBranch(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const branch = branches.get(id);
  if (!branch) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  const updated = { ...branch, ...req.body, updatedAt: new Date() };
  branches.set(id, updated);
  res.json(updated);
}

export async function deleteBranch(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  if (!branches.has(id)) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  branches.delete(id);
  res.json({ message: "Branch deleted" });
}

// Employees
export async function getEmployees(req: Request, res: Response) {
  const { department, status } = req.query;
  let all = Array.from(employees.values());
  if (department) all = all.filter(e => e.department === (Array.isArray(department) ? department[0] : department));
  if (status) all = all.filter(e => e.status === (Array.isArray(status) ? status[0] : status));
  res.json(all);
}

export async function createEmployee(req: Request, res: Response) {
  const id = randomUUID();
  const employee = { id, ...req.body, createdAt: new Date() };
  employees.set(id, employee);
  res.status(201).json(employee);
}

export async function updateEmployee(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const employee = employees.get(id);
  if (!employee) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  Object.assign(employee, req.body);
  res.json(employee);
}

export async function deleteEmployee(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  employees.delete(id);
  res.status(204).send();
}

export async function importEmployees(_req: Request, res: Response) {
  res.json({ imported: 25, skipped: 0, errors: [] });
}
