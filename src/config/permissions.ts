import type { AppRole } from "@prisma/client";

/**
 * Route permission keys — map each Express route to one or more keys.
 * RBAC middleware checks: user must have ANY of the allowed roles for the route's permission key.
 */
export const Permission = {
  // Admin / platform
  SYSTEM_CONFIG: "system.config",
  AUDIT_READ: "audit.read",
  USER_SYNC: "user.sync",
  BRANCH_READ: "branch.read",

  // HR
  HR_LEAVE_READ: "hr.leave.read",
  HR_LEAVE_WRITE: "hr.leave.write",
  HR_LEAVE_APPROVE: "hr.leave.approve",
  HR_ATTENDANCE_READ: "hr.attendance.read",
  HR_ATTENDANCE_READ_SENSITIVE: "hr.attendance.read_sensitive",
  HR_ATTENDANCE_WRITE: "hr.attendance.write",

  // Self-service (employee)
  SELF_PROFILE: "self.profile",
  SELF_LEAVE: "self.leave",
  SELF_ATTENDANCE: "self.attendance",

  // IT
  IT_TICKET_READ_ALL: "it.ticket.read_all",
  IT_TICKET_WRITE: "it.ticket.write",

  // Finance
  FINANCE_READ: "finance.read",
  FINANCE_WRITE: "finance.write",
  FINANCE_APPROVE: "finance.approve",

  // Ops
  OPS_READ: "ops.read",
  OPS_WRITE: "ops.write",

  // Reporting
  REPORTING_READ: "reporting.read",

  // Notifications (admin config)
  NOTIFICATION_CONFIG: "notification.config",
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

/**
 * Matrix: which roles may satisfy each permission key.
 * Super Admin is implied everywhere in middleware (short-circuit).
 */
export const ROLE_PERMISSIONS: Record<AppRole, PermissionKey[]> = {
  SUPER_ADMIN: Object.values(Permission),
  HR_ADMIN: [
    Permission.AUDIT_READ,
    Permission.BRANCH_READ,
    Permission.HR_LEAVE_READ,
    Permission.HR_LEAVE_WRITE,
    Permission.HR_LEAVE_APPROVE,
    Permission.HR_ATTENDANCE_READ,
    Permission.HR_ATTENDANCE_READ_SENSITIVE,
    Permission.HR_ATTENDANCE_WRITE,
    Permission.SELF_PROFILE,
    Permission.SELF_LEAVE,
    Permission.SELF_ATTENDANCE,
    Permission.REPORTING_READ,
    Permission.NOTIFICATION_CONFIG,
  ],
  MANAGER: [
    Permission.BRANCH_READ,
    Permission.HR_LEAVE_READ,
    Permission.HR_LEAVE_APPROVE,
    Permission.SELF_PROFILE,
    Permission.SELF_LEAVE,
    Permission.SELF_ATTENDANCE,
    Permission.IT_TICKET_WRITE,
    Permission.OPS_READ,
    Permission.OPS_WRITE,
    Permission.REPORTING_READ,
  ],
  EMPLOYEE: [
    Permission.BRANCH_READ,
    Permission.SELF_PROFILE,
    Permission.SELF_LEAVE,
    Permission.SELF_ATTENDANCE,
    Permission.IT_TICKET_WRITE,
    Permission.FINANCE_WRITE,
    Permission.OPS_READ,
  ],
  READ_ONLY: [
    Permission.BRANCH_READ,
    Permission.SELF_PROFILE, 
    Permission.HR_LEAVE_READ,
    Permission.IT_TICKET_READ_ALL,
    Permission.FINANCE_READ,
    Permission.OPS_READ,
    Permission.REPORTING_READ,
    Permission.AUDIT_READ,
  ],
};

export function roleHasPermission(role: AppRole, key: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role]?.includes(key) ?? false;
}
