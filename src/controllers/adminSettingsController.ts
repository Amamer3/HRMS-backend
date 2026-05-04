import type { Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import type { AppRole } from "@prisma/client";
import { asyncHandler } from "../lib/asyncHandler.js";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError, UnauthorizedError } from "../lib/errors.js";

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
  const { code, name, latitude, longitude, timezone, workdayStartLocal, workdayEndLocal, geofenceRadiusM, lateGraceMinutes } = req.body;

  if (!code || !name || latitude === undefined || longitude === undefined) {
    throw new BadRequestError("Missing required fields: code, name, latitude, longitude");
  }

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
  const { name, latitude, longitude, timezone, workdayStartLocal, workdayEndLocal, geofenceRadiusM, lateGraceMinutes } = req.body;

  const branch = await prisma.branch.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(latitude !== undefined && { latitude: parseFloat(latitude) }),
      ...(longitude !== undefined && { longitude: parseFloat(longitude) }),
      ...(timezone && { timezone }),
      ...(workdayStartLocal && { workdayStartLocal }),
      ...(workdayEndLocal && { workdayEndLocal }),
      ...(geofenceRadiusM !== undefined && { geofenceRadiusM }),
      ...(lateGraceMinutes !== undefined && { lateGraceMinutes }),
    },
  });

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

  const users = await prisma.user.findMany({
    where: {
      ...(departmentId && { departmentId: departmentId as string }),
      ...(status === "active" && { isActive: true }),
      ...(status === "inactive" && { isActive: false }),
    },
    include: {
      department: true,
      primaryBranch: true,
      rolesResolved: {
        orderBy: {
          syncedAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Map internal roles to frontend expected lowercase strings
  const roleMap: Record<string, string> = {
    SUPER_ADMIN: "super_admin",
    HR_ADMIN: "hr_admin",
    MANAGER: "manager",
    EMPLOYEE: "employee",
    READ_ONLY: "employee",
  };

  res.json(users.map((u) => ({
    ...u,
    name: u.displayName,
    role: roleMap[u.role] || "employee",
    employee_id: u.entraObjectId, // Using Entra ID as staff ID placeholder
  })));
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
 * Logout endpoint - blacklists the current JWT token
 * POST /auth/logout
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new BadRequestError("No token provided");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const userId = req.userId;

  if (!userId) {
    throw new UnauthorizedError("User not authenticated");
  }

  // Decode token to get expiration time
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 3600000); // Default 1 hour

  // Hash the token for storage
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Blacklist the token
  await prisma.tokenBlacklist.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  });

  res.json({ message: "Logged out successfully" });
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
