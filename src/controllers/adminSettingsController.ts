import type { Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import type { AppRole } from "@prisma/client";

// ========================
// BRANCHES
// ========================

export async function getBranches(_req: Request, res: Response) {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { createdAt: "desc" }, 
    });
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch branches" });
  }
}

export async function createBranch(req: Request, res: Response) {
  try {
    const { code, name, latitude, longitude, timezone, workdayStartLocal, workdayEndLocal, geofenceRadiusM, lateGraceMinutes } = req.body;

    if (!code || !name || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: "Missing required fields" });
      return;
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
  } catch (error: any) {
    if (error.code === "P2002") {
      res.status(400).json({ error: "Branch code already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to create branch" });
  }
}

export async function updateBranch(req: Request, res: Response) {
  try {
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
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Branch not found" });
      return;
    }
    res.status(500).json({ error: "Failed to update branch" });
  }
}

export async function deleteBranch(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };

    await prisma.branch.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Branch not found" });
      return;
    }
    res.status(500).json({ error: "Failed to delete branch" });
  }
}

// ========================
// USERS
// ========================

export async function getUsers(req: Request, res: Response) {
  try {
    const { departmentId, status } = req.query;

    const users = await prisma.user.findMany({
      where: {
        ...(departmentId && { departmentId: departmentId as string }),
        ...(status === "active" && { isActive: true }),
        ...(status === "inactive" && { isActive: false }),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        jobTitle: true,
        isActive: true,
        role: true,
        entraObjectId: true,
        departmentId: true,
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        primaryBranchId: true,
        primaryBranch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        rolesResolved: {
          select: {
            roles: true,
            syncedAt: true,
          },
          orderBy: {
            syncedAt: "desc",
          },
          take: 1,
        },
        createdAt: true,
        updatedAt: true,
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
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
}

export async function updateUserRole(req: Request, res: Response) {
  try {
    const { userId } = req.params as { userId: string };
    const { role: requestedRole } = req.body;

    if (!requestedRole) {
      res.status(400).json({ error: "Role is required" });
      return;
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
      res.status(400).json({ error: "Invalid role. Must be one of: super_admin, hr_admin, manager, employee" });
      return;
    }

    // Permission Check: Only SUPER_ADMIN can create/assign another SUPER_ADMIN
    const requesterRoles = req.appRoles || [];
    if (targetRole === "SUPER_ADMIN" && !requesterRoles.includes("SUPER_ADMIN")) {
      res.status(403).json({ error: "Only a super_admin can assign the super_admin role" });
      return;
    }

    // Get the user to update
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
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
  } catch (error) {
    console.error("Update role error:", error);
    res.status(500).json({ error: "Failed to update user role" });
  }
}

// ========================
// BOOTSTRAP & ROLE MANAGEMENT
// ========================

/**
 * Bootstrap the first SUPER_ADMIN user
 * Only works if no SUPER_ADMIN role mapping exists
 * POST /admin/bootstrap
 * Body: { entraObjectId: "user-azure-oid", email: "user@example.com", displayName: "User Name" }
 */
export async function bootstrapSuperAdmin(req: Request, res: Response) {
  try {
    const { entraObjectId, email, displayName } = req.body;

    if (!entraObjectId || !email || !displayName) {
      res.status(400).json({ error: "entraObjectId, email, and displayName are required" });
      return;
    }

    // Check if any SUPER_ADMIN role mapping already exists
    const existingSuperAdmin = await prisma.entraGroupRoleMap.findFirst({
      where: { role: "SUPER_ADMIN" },
    });

    if (existingSuperAdmin) {
      res.status(409).json({ 
        error: "A SUPER_ADMIN role mapping already exists. Use the admin dashboard to manage roles.",
        existingMapping: existingSuperAdmin,
      });
      return;
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
  } catch (error: any) {
    console.error("Bootstrap error:", error);
    res.status(500).json({ error: "Failed to bootstrap SUPER_ADMIN", details: error.message });
  }
}

/**
 * List all Entra group to role mappings
 * GET /admin/role-mappings
 */
export async function getEntraGroupRoleMappings(_req: Request, res: Response) {
  try {
    const mappings = await prisma.entraGroupRoleMap.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json({
      total: mappings.length,
      mappings,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch role mappings" });
  }
}

/**
 * Create or update Entra group to role mapping
 * POST /admin/role-mappings
 * Body: { entraGroupId: "azure-group-oid", role: "HR_ADMIN", description: "HR Team" }
 */
export async function createOrUpdateEntraGroupRoleMapping(req: Request, res: Response) {
  try {
    const { entraGroupId, role, description } = req.body;

    if (!entraGroupId || !role) {
      res.status(400).json({ error: "entraGroupId and role are required" });
      return;
    }

    // Validate role
    const validRoles = ["SUPER_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE", "READ_ONLY"];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
      return;
    }

    const mapping = await prisma.entraGroupRoleMap.upsert({
      where: { entraGroupId },
      create: {
        entraGroupId,
        role,
        description,
      },
      update: {
        role,
        description,
        updatedAt: new Date(),
      },
    });

    res.json({
      message: "Role mapping created/updated successfully",
      mapping,
    });
  } catch (error: any) {
    console.error("Role mapping error:", error);
    res.status(500).json({ error: "Failed to create/update role mapping", details: error.message });
  }
}

/**
 * Delete Entra group to role mapping
 * DELETE /admin/role-mappings/:entraGroupId
 */
export async function deleteEntraGroupRoleMapping(req: Request, res: Response) {
  try {
    const { entraGroupId } = req.params as { entraGroupId: string };

    // Prevent deleting the SUPER_ADMIN bootstrap mapping
    const mapping = await prisma.entraGroupRoleMap.findUnique({
      where: { entraGroupId },
    });

    if (!mapping) {
      res.status(404).json({ error: "Role mapping not found" });
      return;
    }

    if (mapping.role === "SUPER_ADMIN") {
      res.status(409).json({ error: "Cannot delete SUPER_ADMIN role mappings. Contact system administrator." });
      return;
    }

    await prisma.entraGroupRoleMap.delete({
      where: { entraGroupId },
    });

    res.status(204).send();
  } catch (error: any) {
    console.error("Delete role mapping error:", error);
    res.status(500).json({ error: "Failed to delete role mapping", details: error.message });
  }
}

/**
 * Logout endpoint - blacklists the current JWT token
 * POST /auth/logout
 */
export async function logout(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(400).json({ error: "No token provided" });
      return;
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const userId = req.userId;

    if (!userId) {
      res.status(400).json({ error: "User not authenticated" });
      return;
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
  } catch (error: any) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Failed to logout", details: error.message });
  }
}

/**
 * Clean up expired blacklisted tokens
 * POST /admin/cleanup-tokens
 */
export async function cleanupExpiredTokens(_req: Request, res: Response) {
  try {
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
  } catch (error: any) {
    console.error("Token cleanup error:", error);
    res.status(500).json({ error: "Failed to cleanup tokens", details: error.message });
  }
}
