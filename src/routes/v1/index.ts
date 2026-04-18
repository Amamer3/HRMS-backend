import { Router } from "express";
import { getMe } from "../../controllers/meController.js";
import { getAuditLogs } from "../../controllers/auditController.js";
import { getClockEventsForUser, postClock, postClockSyncBatch } from "../../controllers/attendanceController.js";
import { listMyLeaves, postLeaveRequest } from "../../controllers/leaveController.js";
import { Permission } from "../../config/permissions.js";
import { requirePermission } from "../../middleware/requireRole.js";
import { requireHrSensitiveAttendance } from "../../middleware/requireRole.js";

export function buildV1Router(): Router {
  const r = Router();

  r.get("/me", requirePermission(Permission.SELF_PROFILE), getMe);

  r.get(
    "/audit/logs",
    requirePermission(Permission.AUDIT_READ),
    (req, res, next) => void getAuditLogs(req, res).catch(next),
  );

  r.post(
    "/hr/leave",
    requirePermission(Permission.SELF_LEAVE),
    (req, res, next) => void postLeaveRequest(req, res).catch(next),
  );
  r.get(
    "/hr/leave/me",
    requirePermission(Permission.SELF_LEAVE),
    (req, res, next) => void listMyLeaves(req, res).catch(next),
  );

  r.post(
    "/attendance/clock",
    requirePermission(Permission.SELF_ATTENDANCE),
    (req, res, next) => void postClock(req, res).catch(next),
  );
  r.post(
    "/attendance/clock/sync",
    requirePermission(Permission.SELF_ATTENDANCE),
    (req, res, next) => void postClockSyncBatch(req, res).catch(next),
  );
  r.get(
    "/attendance/users/:userId/clock-events",
    requireHrSensitiveAttendance,
    (req, res, next) => void getClockEventsForUser(req, res).catch(next),
  );

  // Stubs — wire to controllers as modules are implemented
  r.get("/it/tickets", requirePermission(Permission.IT_TICKET_READ_ALL), (_req, res) => {
    res.json({ items: [] });
  });
  r.get("/finance/requests", requirePermission(Permission.FINANCE_READ), (_req, res) => {
    res.json({ items: [] });
  });
  r.get("/ops/pipeline", requirePermission(Permission.OPS_READ), (_req, res) => {
    res.json({ items: [] });
  });
  r.get("/payroll/runs", requirePermission(Permission.HR_PAYROLL_READ), (_req, res) => {
    res.json({ items: [] });
  });
  r.get("/reports/summary", requirePermission(Permission.REPORTING_READ), (_req, res) => {
    res.json({ summary: {} });
  });

  return r;
}
