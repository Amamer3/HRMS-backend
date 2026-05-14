import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { seedYearlyLeaveBalancesForUser } from "../services/leaveBalanceService.js";

// Employees
export const getEmployees = asyncHandler(async (req: Request, res: Response) => {
  const { departmentId, status } = req.query;
  
  const employees = await prisma.user.findMany({
    where: {
      ...(departmentId && { departmentId: departmentId as string }),
      ...(status === "active" && { isActive: true }),
      ...(status === "inactive" && { isActive: false }),
    },
    include: {
      department: true,
      primaryBranch: true,
    },
    orderBy: { displayName: "asc" },
  });

  res.json(employees);
});

export const createEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { email, displayName, entraObjectId, role, departmentId, primaryBranchId } = req.body;
  
  const employee = await prisma.user.create({
    data: {
      email,
      displayName,
      entraObjectId,
      role: role || "EMPLOYEE",
      departmentId,
      primaryBranchId,
      isActive: true,
    },
  });

  await seedYearlyLeaveBalancesForUser(prisma, employee.id);

  res.status(201).json(employee);
});

export const updateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { email, displayName, jobTitle, departmentId, primaryBranchId, isActive } = req.body;

  const employee = await prisma.user.update({
    where: { id },
    data: {
      ...(email !== undefined && { email }),
      ...(displayName !== undefined && { displayName }),
      ...(jobTitle !== undefined && { jobTitle }),
      ...(departmentId !== undefined && { departmentId }),
      ...(primaryBranchId !== undefined && { primaryBranchId }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  res.json(employee);
});

export const deleteEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  
  await prisma.user.delete({
    where: { id },
  });

  res.status(204).send();
});

export const importEmployees = asyncHandler(async (_req: Request, res: Response) => {
  // This would normally involve bulk creation logic
  res.json({ message: "Bulk import logic not implemented yet", imported: 0 });
});

// Branches (delegated to adminSettingsController in routes, but keeping these if needed)
export const getBranches = asyncHandler(async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany();
  res.json(branches);
});

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  const { code, name, latitude, longitude, timezone, workdayStartLocal, workdayEndLocal, geofenceRadiusM, lateGraceMinutes } = req.body;
  const branch = await prisma.branch.create({
    data: {
      code,
      name,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      timezone: timezone || "Africa/Accra",
      workdayStartLocal: workdayStartLocal || "08:00",
      workdayEndLocal: workdayEndLocal || "17:00",
      geofenceRadiusM: geofenceRadiusM || 30,
      lateGraceMinutes: lateGraceMinutes || 10,
    },
  });
  res.status(201).json(branch);
});

export const updateBranch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { code, name, latitude, longitude, timezone, workdayStartLocal, workdayEndLocal, geofenceRadiusM, lateGraceMinutes } = req.body;
  const branch = await prisma.branch.update({
    where: { id },
    data: {
      ...(code !== undefined && { code }),
      ...(name !== undefined && { name }),
      ...(latitude !== undefined && { latitude: parseFloat(latitude) }),
      ...(longitude !== undefined && { longitude: parseFloat(longitude) }),
      ...(timezone !== undefined && { timezone }),
      ...(workdayStartLocal !== undefined && { workdayStartLocal }),
      ...(workdayEndLocal !== undefined && { workdayEndLocal }),
      ...(geofenceRadiusM !== undefined && { geofenceRadiusM }),
      ...(lateGraceMinutes !== undefined && { lateGraceMinutes }),
    },
  });
  res.json(branch);
});

export const deleteBranch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  await prisma.branch.delete({ where: { id } });
  res.json({ message: "Branch deleted" });
});
