import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import type { AppRole } from "@prisma/client";
import { asyncHandler } from "../lib/asyncHandler.js";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../lib/errors.js";

const localTimeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createBranchBody = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  timezone: z.string().default("Africa/Accra"),
  workdayStartLocal: z.string().regex(localTimeRegex, "Must be HH:MM").default("08:00"),
  workdayEndLocal: z.string().regex(localTimeRegex, "Must be HH:MM").default("17:00"),
  geofenceRadiusM: z.coerce.number().int().min(1).max(10000).default(30),
  lateGraceMinutes: z.coerce.number().int().min(0).max(120).default(10),
});

const updateBranchBody = z.object({
  name: z.string().min(1).max(100).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  timezone: z.string().optional(),
  workdayStartLocal: z.string().regex(localTimeRegex, "Must be HH:MM").optional(),
  workdayEndLocal: z.string().regex(localTimeRegex, "Must be HH:MM").optional(),
  geofenceRadiusM: z.coerce.number().int().min(1).max(10000).optional(),
  lateGraceMinutes: z.coerce.number().int().min(0).max(120).optional(),
});

// ========================
// BRANCHES
// ========================

export const getBranches = asyncHandler(async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({
    orderBy: { createdAt: "desc" }, 
  });
  res.json(branches);
});

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  const data = createBranchBody.parse(req.body);

  const branch = await prisma.branch.create({ data });

  res.status(201).json(branch);
});

export const updateBranch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const data = updateBranchBody.parse(req.body);

  const branch = await prisma.branch.update({ where: { id }, data });

  res.json(branch);
});

export const deleteBranch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  await prisma.branch.delete({
    where: { id },
  });

  res.status(204).send();
});

// ========================
// USERS
// ========================

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const { departmentId, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const where = {
    ...(departmentId && { departmentId: departmentId as string }),
    ...(status === "active" && { isActive: true }),
    ...(status === "inactive" && { isActive: false }),
  };

  const users = await prisma.user.findMany({
    where,
    include: {
      department: true,
      primaryBranch: true,
      rolesResolved: {
        orderBy: { syncedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  // Map internal roles to frontend expected lowercase strings
  const roleMap: Record<string, string> = {
    SUPER_ADMIN: "super_admin",
    HR_ADMIN: "hr_admin",
    MANAGER: "manager",
    EMPLOYEE: "employee",
    READ_ONLY: "employee",
  };

  const items = users.map(u => ({
    ...u,
    name: u.displayName,
    role: roleMap[u.role] ?? "employee",
    employee_id: u.entraObjectId,
  }));

  res.json({ items, page, limit });
});

export const updateUserRole = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const { role: requestedRole } = req.body;

  if (!requestedRole) {
    throw new BadRequestError("Role is required");
  }

  // Map frontend lowercase roles to backend enum
  const roleInputMap: Record<string, AppRole> = {
    "super_admin": "SUPER_ADMIN",
    "hr_admin": "HR_ADMIN",
    "manager": "MANAGER",
    "employee": "EMPLOYEE"
  };

  const targetRole = roleInputMap[requestedRole];
  if (!targetRole) {
    throw new BadRequestError("Invalid role. Must be one of: super_admin, hr_admin, manager, employee");
  }

  // Permission Check: Only SUPER_ADMIN can create/assign another SUPER_ADMIN
  const requesterRoles = req.appRoles || [];
  if (targetRole === "SUPER_ADMIN" && !requesterRoles.includes("SUPER_ADMIN")) {
    throw new ForbiddenError("Only a super_admin can assign the super_admin role");
  }

  // Get the user to update
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // Update the user's role directly on the User model
  await prisma.user.update({
    where: { id: userId },
    data: { role: targetRole },
  });

  // Sync with EntraGroupRoleMap for persistent mapping
  // We use a pseudo-group ID for manual assignments to ensure they persist across syncs
  await prisma.entraGroupRoleMap.upsert({
    where: {
      entraGroupId: `manual-role-${user.id}`,
    },
    create: {
      entraGroupId: `manual-role-${user.id}`,
      role: targetRole,
      description: `Manual role assignment for ${user.email}`,
    },
    update: {
      role: targetRole,
      description: `Manual role assignment for ${user.email}`,
    },
  });

  // Create a new UserRoleSnapshot to record this change
  await prisma.userRoleSnapshot.create({
    data: {
      userId: userId,
      roles: [targetRole],
      syncedAt: new Date(),
    },
  });

  res.json({
    id: user.id,
    name: user.displayName,
    email: user.email,
    role: requestedRole,
  });
});

// ========================
// BOOTSTRAP & ROLE MANAGEMENT
// ========================

/**
 * Bootstrap the first SUPER_ADMIN user
 * Only works if no SUPER_ADMIN role mapping exists
 * POST /admin/bootstrap
 * Body: { entraObjectId: "user-azure-oid", email: "user@example.com", displayName: "User Name" }
 */
export const bootstrapSuperAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { entraObjectId, email, displayName } = req.body;

  if (!entraObjectId || !email || !displayName) {
    throw new BadRequestError("entraObjectId, email, and displayName are required");
  }

  // Check if any SUPER_ADMIN role mapping already exists
  const existingSuperAdmin = await prisma.entraGroupRoleMap.findFirst({
    where: { role: "SUPER_ADMIN" },
  });

  if (existingSuperAdmin) {
    throw new ConflictError("A SUPER_ADMIN role mapping already exists. Use the admin dashboard to manage roles.", {
      existingMapping: existingSuperAdmin,
    });
  }

  // Create or get the user
  let user = await prisma.user.findUnique({
    where: { entraObjectId },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        entraObjectId,
        email,
        displayName,
        isActive: true,
        role: "SUPER_ADMIN",
      },
    });
  } else {
    // Ensure existing user has the correct role if bootstrapped
    await prisma.user.update({
      where: { id: user.id },
      data: { role: "SUPER_ADMIN" },
    });
  }

  if (!user) {
    throw new Error("Failed to create or retrieve user during bootstrap");
  }

  // Create SUPER_ADMIN role mapping using user's Entra object ID
  const roleMapping = await prisma.entraGroupRoleMap.create({
    data: {
      entraGroupId: entraObjectId, // Use the user's own Entra OID as a pseudo-group
      role: "SUPER_ADMIN",
      description: `Bootstrap SUPER_ADMIN: ${displayName} (${email})`,
    },
  });

  // Create role snapshot
  await prisma.userRoleSnapshot.create({
    data: {
      userId: user.id,
      roles: ["SUPER_ADMIN"],
      syncedAt: new Date(),
    },
  });

  res.status(201).json({
    message: "SUPER_ADMIN bootstrapped successfully",
    user: {
      id: user.id,
      entraObjectId: user.entraObjectId,
      email: user.email,
      displayName: user.displayName,
    },
    roleMapping,
  });
});

/**
 * List all Entra group to role mappings
 * GET /admin/role-mappings
 */
export const getEntraGroupRoleMappings = asyncHandler(async (_req: Request, res: Response) => {
  const mappings = await prisma.entraGroupRoleMap.findMany({
    orderBy: { createdAt: "desc" },
  });

  res.json({
    total: mappings.length,
    mappings,
  });
});

/**
 * Create or update Entra group to role mapping
 * POST /admin/role-mappings
 * Body: { entraGroupId: "azure-group-oid", role: "HR_ADMIN", description: "HR Team" }
 */
export const createOrUpdateEntraGroupRoleMapping = asyncHandler(async (req: Request, res: Response) => {
  const { entraGroupId, role, description } = req.body;

  if (!entraGroupId || !role) {
    throw new BadRequestError("entraGroupId and role are required");
  }

  // Validate role
  const validRoles = ["SUPER_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE", "READ_ONLY"];
  if (!validRoles.includes(role)) {
    throw new BadRequestError(`Invalid role. Must be one of: ${validRoles.join(", ")}`);
  }

  const mapping = await prisma.entraGroupRoleMap.upsert({
    where: { entraGroupId },
    create: {
      entraGroupId,
      role: role as AppRole,
      description,
    },
    update: {
      role: role as AppRole,
      description,
      updatedAt: new Date(),
    },
  });

  res.json({
    message: "Role mapping created/updated successfully",
    mapping,
  });
});

/**
 * Delete Entra group to role mapping
 * DELETE /admin/role-mappings/:entraGroupId
 */
export const deleteEntraGroupRoleMapping = asyncHandler(async (req: Request, res: Response) => {
  const { entraGroupId } = req.params as { entraGroupId: string };

  // Prevent deleting the SUPER_ADMIN bootstrap mapping
  const mapping = await prisma.entraGroupRoleMap.findUnique({
    where: { entraGroupId },
  });

  if (!mapping) {
    throw new NotFoundError("Role mapping not found");
  }

  if (mapping.role === "SUPER_ADMIN") {
    throw new ConflictError("Cannot delete SUPER_ADMIN role mappings. Contact system administrator.");
  }

  await prisma.entraGroupRoleMap.delete({
    where: { entraGroupId },
  });

  res.status(204).send();
});

/**
 * Clean up expired blacklisted tokens
 * POST /admin/cleanup-tokens
 */
export const cleanupExpiredTokens = asyncHandler(async (_req: Request, res: Response) => {
  const result = await prisma.tokenBlacklist.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  res.json({
    message: "Expired tokens cleaned up",
    deletedCount: result.count,
  });
});
