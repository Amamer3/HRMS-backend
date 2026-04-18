import type { NextFunction, Request, Response } from "express";
import type { AppRole } from "@prisma/client";
import { Permission, type PermissionKey, roleHasPermission } from "../config/permissions.js";

/**
 * Express middleware: enforce permission at API layer. 
 * - SUPER_ADMIN bypasses checks.
 * - Otherwise user needs at least one resolved role that grants the permission.
 */
export function requirePermission(...keys: PermissionKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.appRoles ?? [];
    if (roles.includes("SUPER_ADMIN" as AppRole)) {
      next();
      return;
    }
    const allowed = keys.some((key) => roles.some((r) => roleHasPermission(r, key)));
    if (!allowed) {
      res.status(403).json({
        error: "forbidden",
        message: "Insufficient permissions for this resource",
        required: keys,
      });
      return;
    }
    next();
  };
}

/** Convenience: explicit minimum role set (still intersects with permission model in routes). */
export function requireAnyAppRole(...allowed: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.appRoles ?? [];
    if (roles.includes("SUPER_ADMIN" as AppRole)) {
      next();
      return;
    }
    const ok = roles.some((r) => allowed.includes(r));
    if (!ok) {
      res.status(403).json({ error: "forbidden", message: "Role not allowed" });
      return;
    }
    next();
  };
}

/** HR Admin or Super Admin only — for GPS audit endpoints. */
export const requireHrSensitiveAttendance = requirePermission(
  Permission.HR_ATTENDANCE_READ_SENSITIVE,
);
