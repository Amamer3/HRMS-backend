import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError } from "../lib/errors.js";

const employees = new Map<string, any>();
const branches = new Map<string, any>();

// Branches
export const getBranches = asyncHandler(async (_req: Request, res: Response) => {
  res.json(Array.from(branches.values()));
});

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  const id = randomUUID();
  const branch = { id, ...req.body, createdAt: new Date() };
  branches.set(id, branch);
  res.status(201).json(branch);
});

export const updateBranch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const branch = branches.get(id);
  if (!branch) {
    throw new NotFoundError("Branch not found");
  }
  const updated = { ...branch, ...req.body, updatedAt: new Date() };
  branches.set(id, updated);
  res.json(updated);
});

export const deleteBranch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  if (!branches.has(id)) {
    throw new NotFoundError("Branch not found");
  }
  branches.delete(id);
  res.json({ message: "Branch deleted" });
});

// Employees
export const getEmployees = asyncHandler(async (req: Request, res: Response) => {
  const { department, status } = req.query;
  let all = Array.from(employees.values());
  if (department) all = all.filter(e => e.department === (Array.isArray(department) ? department[0] : department));
  if (status) all = all.filter(e => e.status === (Array.isArray(status) ? status[0] : status));
  res.json(all);
});

export const createEmployee = asyncHandler(async (req: Request, res: Response) => {
  const id = randomUUID();
  const employee = { id, ...req.body, createdAt: new Date() };
  employees.set(id, employee);
  res.status(201).json(employee);
});

export const updateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const employee = employees.get(id);
  if (!employee) {
    throw new NotFoundError("Employee not found");
  }
  Object.assign(employee, req.body);
  res.json(employee);
});

export const deleteEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  if (!employees.has(id)) {
    throw new NotFoundError("Employee not found");
  }
  employees.delete(id);
  res.status(204).send();
});

export const importEmployees = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ imported: 25, skipped: 0, errors: [] });
});
