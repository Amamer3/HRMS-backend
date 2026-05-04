import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

const employees = new Map<string, any>();
const shifts = new Map<string, any>();
const shiftAssignments = new Map<string, any>();
const appraisals = new Map<string, any>();
const performanceTargets = new Map<string, any>();
const birthdays = new Map<string, any>();
const branches = new Map<string, any>();

// Birthdays
export async function getUpcomingBirthdays(req: Request, res: Response) {
  const { days = 30 } = req.query;
  const upcoming = Array.from(birthdays.values())
    .filter(b => b.daysUntilBirthday <= Number(days))
    .sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);
  res.json(upcoming);
}

export async function getBirthdayItems(_req: Request, res: Response) {
  res.json(Array.from(birthdays.values()));
}

export async function createBirthdayItem(req: Request, res: Response) {
  const id = randomUUID();
  const item = { id, ...req.body, createdAt: new Date() };
  birthdays.set(id, item);
  res.status(201).json(item);
}

export async function publishBirthdayItem(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const item = birthdays.get(id);
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  item.published = true;
  res.json(item);
}

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

// Appraisals
export async function getAppraisals(req: Request, res: Response) {
  const { employeeId, year } = req.query;
  let all = Array.from(appraisals.values());
  if (employeeId) all = all.filter(a => a.employeeId === employeeId);
  if (year) all = all.filter(a => a.year === Number(year));
  res.json(all);
}

export async function createAppraisal(req: Request, res: Response) {
  const id = randomUUID();
  const appraisal = { id, ...req.body, createdAt: new Date() };
  appraisals.set(id, appraisal);
  res.status(201).json(appraisal);
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

// Shifts
export async function getShifts(_req: Request, res: Response) {
  res.json(Array.from(shifts.values()));
}

export async function createShift(req: Request, res: Response) {
  const id = randomUUID();
  const shift = { id, ...req.body };
  shifts.set(id, shift);
  res.status(201).json(shift);
}

export async function deleteShift(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  shifts.delete(id);
  res.status(204).send();
}

// Shift Assignments
export async function getShiftAssignments(req: Request, res: Response) {
  const { employeeId } = req.query;
  let all = Array.from(shiftAssignments.values());
  if (employeeId) all = all.filter(a => a.employeeId === (Array.isArray(employeeId) ? employeeId[0] : employeeId));
  res.json(all);
}

export async function createShiftAssignment(req: Request, res: Response) {
  const id = randomUUID();
  const assignment = { id, ...req.body };
  shiftAssignments.set(id, assignment);
  res.status(201).json(assignment);
}

// Performance Targets
export async function getPerformanceTargets(req: Request, res: Response) {
  const { employeeId } = req.query;
  let all = Array.from(performanceTargets.values());
  if (employeeId) all = all.filter(t => t.employeeId === (Array.isArray(employeeId) ? employeeId[0] : employeeId));
  res.json(all);
}

export async function createPerformanceTarget(req: Request, res: Response) {
  const id = randomUUID();
  const target = { id, ...req.body, status: "PENDING" };
  performanceTargets.set(id, target);
  res.status(201).json(target);
}

export async function submitPerformanceTarget(req: Request, res: Response) {
  const id = req.params.id as string;
  const target = performanceTargets.get(id);
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  target.status = "SUBMITTED";
  res.json(target);
}

// Payroll
export async function getPayroll(req: Request, res: Response) {
  const { month, year } = req.query;
  res.json([
    {
      id: randomUUID(),
      employeeId: randomUUID(),
      month: Number(month),
      year: Number(year),
      basicSalary: 50000,
      allowances: 10000,
      deductions: 5000,
      netSalary: 55000,
      status: "APPROVED",
    },
  ]);
}

export async function generatePayroll(req: Request, res: Response) {
  const { month, year } = req.query;
  res.json({ 
    success: true, 
    month: Number(month), 
    year: Number(year), 
    generated: 150 
  });
}
