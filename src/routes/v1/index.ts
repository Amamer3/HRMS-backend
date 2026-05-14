import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getMe } from "../../controllers/meController.js";
import { getAuditLogs } from "../../controllers/auditController.js";
import {
  getClockEventsForUser,
  postClock,
  postClockSyncBatch,
  getTodayAttendance,
  checkIn,
  checkOut,
  getAttendanceHistory,
  requestCorrection,
  getMyCorrections,
} from "../../controllers/attendanceController.js";
import {
  listMyLeaves,
  postLeaveRequest,
  getMyLeaveBalances,
  getLeaveTypes,
} from "../../controllers/leaveController.js";
import { getHealth } from "../../controllers/healthController.js";
import { getSummary, getAttendanceReport, getLeaveReport } from "../../controllers/reportController.js";
import {
  getAllLeaves,
  getPendingDashboard,
  updateLeave,
  deleteLeave,
  approveLeave,
  rejectLeave,
  returnLeave,
  submitLeave,
} from "../../controllers/leaveManagementController.js";
import {
  getAllAttendance,
  getCorrections,
  approveCorrection,
  rejectCorrection,
} from "../../controllers/attendanceManagementController.js";
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  importEmployees,
} from "../../controllers/hrController.js";
import {
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  getUsers,
  updateUserRole,
  bootstrapSuperAdmin,
  getEntraGroupRoleMappings,
  createOrUpdateEntraGroupRoleMapping,
  deleteEntraGroupRoleMapping,
  cleanupExpiredTokens,
} from "../../controllers/adminSettingsController.js";
import {
  getFinanceRequests,
  createFinanceRequest,
  approveFinanceRequest,
  rejectFinanceRequest,
} from "../../controllers/financeController.js";
import {
  getTickets,
  createTicket,
  updateTicket,
  deleteTicket,
  getQueues,
} from "../../controllers/itController.js";
import {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getConversations,
  createConversation,
} from "../../controllers/operationsController.js";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "../../controllers/notificationsController.js";
import { Permission } from "../../config/permissions.js";
import { requirePermission, requireHrSensitiveAttendance } from "../../middleware/requireRole.js";
import { buildAuthRouter, logout } from "../../controllers/authController.js";
import type { Env } from "../../config/env.js";

// Rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many requests, please try again later" },
});

// Stricter limiter for token exchange (prevents code brute-forcing)
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many token requests, please try again later" },
});

export function buildV1Router(env: Env): Router {
  const r = Router();

  r.get("/health", getHealth);

  // ============================================================
  // BOOTSTRAP
  // ============================================================
  r.post("/admin/bootstrap", bootstrapSuperAdmin);

  // ============================================================
  // AUTH — delegated to authController
  // ============================================================
  const azureRouter = buildAuthRouter(env);
  r.use("/auth/azure", authLimiter, azureRouter);
  // /auth/azure/token gets an additional stricter window on top of authLimiter
  r.use("/auth/azure/token", tokenLimiter);

  r.get("/auth/me", getMe);
  r.post("/auth/logout", logout);
  r.post("/auth/refresh", requirePermission(Permission.SELF_PROFILE), (_req, res) => {
    res.json({ message: "Token is valid", valid: true });
  });

  // ============================================================
  // AUDIT
  // ============================================================
  r.get("/audit/logs", requirePermission(Permission.AUDIT_READ), getAuditLogs);
  r.get("/audit-log", requirePermission(Permission.AUDIT_READ), getAuditLogs);

  // ============================================================
  // USERS
  // ============================================================
  r.get("/users", requirePermission(Permission.HR_ATTENDANCE_READ), getUsers);
  r.put("/users/:userId/role", requirePermission(Permission.SYSTEM_CONFIG), updateUserRole);

  // ============================================================
  // ROLE MAPPINGS
  // ============================================================
  r.get("/admin/role-mappings", requirePermission(Permission.SYSTEM_CONFIG), getEntraGroupRoleMappings);
  r.post("/admin/role-mappings", requirePermission(Permission.SYSTEM_CONFIG), createOrUpdateEntraGroupRoleMapping);
  r.delete("/admin/role-mappings/:entraGroupId", requirePermission(Permission.SYSTEM_CONFIG), deleteEntraGroupRoleMapping);
  r.post("/admin/cleanup-tokens", requirePermission(Permission.SYSTEM_CONFIG), cleanupExpiredTokens);

  // ============================================================
  // REPORTS
  // ============================================================
  r.get("/reports/summary", requirePermission(Permission.REPORTING_READ), getSummary);
  r.get("/reports/attendance", requirePermission(Permission.REPORTING_READ), getAttendanceReport);
  r.get("/reports/leave", requirePermission(Permission.REPORTING_READ), getLeaveReport);

  // ============================================================
  // LEAVE
  // ============================================================
  r.get("/leave", requirePermission(Permission.HR_LEAVE_READ, Permission.SELF_LEAVE), getAllLeaves);
  r.get("/leave/types", requirePermission(Permission.SELF_LEAVE), getLeaveTypes);
  r.get("/leave/type", requirePermission(Permission.SELF_LEAVE), getLeaveTypes);
  r.get("/leave-types", requirePermission(Permission.SELF_LEAVE), getLeaveTypes);
  r.get("/leave/admin/all", requirePermission(Permission.HR_LEAVE_READ), getAllLeaves);
  r.post("/leave", requirePermission(Permission.SELF_LEAVE), postLeaveRequest);
  r.get("/leave/pending-dashboard", requirePermission(Permission.HR_LEAVE_APPROVE), getPendingDashboard);
  r.put("/leave/:id", requirePermission(Permission.SELF_LEAVE), updateLeave);
  r.delete("/leave/:id", requirePermission(Permission.HR_LEAVE_WRITE), deleteLeave);
  r.put("/leave/:id/approve", requirePermission(Permission.HR_LEAVE_APPROVE), approveLeave);
  r.put("/leave/:id/reject", requirePermission(Permission.HR_LEAVE_APPROVE), rejectLeave);
  r.put("/leave/:id/return", requirePermission(Permission.HR_LEAVE_APPROVE), returnLeave);
  r.put("/leave/:id/submit", requirePermission(Permission.SELF_LEAVE), submitLeave);

  // ============================================================
  // ATTENDANCE — self-service
  // ============================================================
  r.get("/attendance/today", requirePermission(Permission.SELF_ATTENDANCE), getTodayAttendance);
  r.get("/attendance/history", requirePermission(Permission.SELF_ATTENDANCE), getAttendanceHistory);
  r.get("/attendance/corrections/my", requirePermission(Permission.SELF_ATTENDANCE), getMyCorrections);
  r.post("/attendance/corrections", requirePermission(Permission.SELF_ATTENDANCE), requestCorrection);
  r.post("/attendance/check-in", requirePermission(Permission.SELF_ATTENDANCE), checkIn);
  r.post("/attendance/check-out", requirePermission(Permission.SELF_ATTENDANCE), checkOut);

  // ATTENDANCE — admin
  r.get("/attendance/admin/list", requirePermission(Permission.HR_ATTENDANCE_READ), getAllAttendance);
  r.get("/attendance/corrections", requirePermission(Permission.HR_ATTENDANCE_READ), getCorrections);
  r.put("/attendance/corrections/:id/approve", requirePermission(Permission.HR_ATTENDANCE_WRITE), approveCorrection);
  r.put("/attendance/corrections/:id/reject", requirePermission(Permission.HR_ATTENDANCE_WRITE), rejectCorrection);

  // ATTENDANCE — legacy clock endpoints
  r.post("/attendance/clock", requirePermission(Permission.SELF_ATTENDANCE), postClock);
  r.post("/attendance/clock/sync", requirePermission(Permission.SELF_ATTENDANCE), postClockSyncBatch);
  r.get("/attendance/users/:userId/clock-events", requireHrSensitiveAttendance, getClockEventsForUser);

  // ============================================================
  // BRANCHES
  // ============================================================
  r.get("/branches", requirePermission(Permission.BRANCH_READ), getBranches);
  r.get("/branches/list", requirePermission(Permission.BRANCH_READ), getBranches);
  r.post("/branches", requirePermission(Permission.HR_LEAVE_WRITE), createBranch);
  r.put("/branches/:id", requirePermission(Permission.HR_LEAVE_WRITE), updateBranch);
  r.delete("/branches/:id", requirePermission(Permission.HR_LEAVE_WRITE), deleteBranch);

  // ============================================================
  // EMPLOYEES
  // ============================================================
  r.get("/employees", requirePermission(Permission.HR_LEAVE_READ), getEmployees);
  r.post("/employees", requirePermission(Permission.HR_LEAVE_WRITE), createEmployee);
  r.put("/employees/:id", requirePermission(Permission.HR_LEAVE_WRITE), updateEmployee);
  r.delete("/employees/:id", requirePermission(Permission.HR_LEAVE_WRITE), deleteEmployee);
  r.post("/employees/import", requirePermission(Permission.HR_LEAVE_WRITE), importEmployees);

  // Legacy leave endpoints
  r.post("/hr/leave", requirePermission(Permission.SELF_LEAVE), postLeaveRequest);
  r.get("/hr/leave/me", requirePermission(Permission.SELF_LEAVE), listMyLeaves);
  r.get("/leave/balance", requirePermission(Permission.SELF_LEAVE), getMyLeaveBalances);

  // ============================================================
  // FINANCE
  // ============================================================
  r.get("/finance/requests", requirePermission(Permission.FINANCE_READ), getFinanceRequests);
  r.post("/finance/requests", requirePermission(Permission.FINANCE_WRITE), createFinanceRequest);
  r.put("/finance/requests/:id/approve", requirePermission(Permission.FINANCE_APPROVE), approveFinanceRequest);
  r.put("/finance/requests/:id/reject", requirePermission(Permission.FINANCE_APPROVE), rejectFinanceRequest);

  // ============================================================
  // IT TICKETS
  // ============================================================
  r.get("/tickets", requirePermission(Permission.IT_TICKET_READ_ALL), getTickets);
  r.post("/tickets", requirePermission(Permission.IT_TICKET_WRITE), createTicket);
  r.put("/tickets/:id", requirePermission(Permission.IT_TICKET_WRITE), updateTicket);
  r.delete("/tickets/:id", requirePermission(Permission.IT_TICKET_WRITE), deleteTicket);
  r.get("/it/queues", requirePermission(Permission.IT_TICKET_READ_ALL), getQueues);

  // ============================================================
  // OPERATIONS
  // ============================================================
  r.get("/clients", requirePermission(Permission.OPS_READ), getClients);
  r.post("/clients", requirePermission(Permission.OPS_WRITE), createClient);
  r.put("/clients/:id", requirePermission(Permission.OPS_WRITE), updateClient);
  r.delete("/clients/:id", requirePermission(Permission.OPS_WRITE), deleteClient);
  r.get("/conversations", requirePermission(Permission.OPS_READ), getConversations);
  r.post("/conversations", requirePermission(Permission.OPS_WRITE), createConversation);

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  r.get("/notifications", requirePermission(Permission.SELF_PROFILE), getNotifications);
  r.put("/notifications/:id/read", requirePermission(Permission.SELF_PROFILE), markAsRead);
  r.put("/notifications/read-all", requirePermission(Permission.SELF_PROFILE), markAllAsRead);

  return r;
}
