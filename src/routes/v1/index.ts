import { Router } from "express";
import crypto from "crypto";
import { getMe } from "../../controllers/meController.js";
import { getAuditLogs } from "../../controllers/auditController.js";
import { getClockEventsForUser, postClock, postClockSyncBatch } from "../../controllers/attendanceController.js";
import { listMyLeaves, postLeaveRequest } from "../../controllers/leaveController.js";
import { getHealth } from "../../controllers/healthController.js";
import { getSummary, getAttendanceReport, getLeaveReport } from "../../controllers/reportController.js";
import { 
  getAllLeaves, 
  getPendingDashboard, 
  createLeave, 
  updateLeave, 
  deleteLeave, 
  approveLEave, 
  rejectLeave, 
  returnLeave, 
  submitLeave 
} from "../../controllers/leaveManagementController.js";
import {
  getAllAttendance,
  getTodayAttendance,
  getCorrections,
  requestCorrection,
  checkIn,
  checkOut,
  approveCorrection,
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
  logout,
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
import { requirePermission } from "../../middleware/requireRole.js";
import { requireHrSensitiveAttendance } from "../../middleware/requireRole.js";
import type { Env } from "../../config/env.js";

function buildAzureAuthScope(envScope: string | undefined) {
  const providedScopes = envScope?.split(/\s+/).filter(Boolean) ?? [];
  return Array.from(new Set(providedScopes)).join(" ");
}

interface AzureTokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
  error?: string;
  error_description?: string;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err: any) {
      lastError = err;
      if (err.code === 'EAI_AGAIN' || err.message?.includes('getaddrinfo')) {
        console.warn(`DNS lookup failed (attempt ${i + 1}/${retries}). Retrying in 1s...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export function buildV1Router(env: Env): Router {
   const r = Router();
 
   r.get("/health", getHealth);
 
   // ============================================================
   // BOOTSTRAP & ADMIN - Role Management
   // ============================================================
   // Bootstrap endpoint (public) - only works if no SUPER_ADMIN exists
   r.post("/admin/bootstrap", (req, res, next) => void bootstrapSuperAdmin(req, res).catch(next));
 
   // Public authentication endpoints (no auth required)
   r.get("/auth/azure/login", (req, res) => {
     const defaultRedirect = env.NODE_ENV === 'production' 
       ? 'https://hrms.echt.gh/auth/callback' 
       : 'http://localhost:3000/auth/callback';
     const redirectUri = req.query.redirect_uri as string || defaultRedirect;
     const tenantId = env.AZURE_AD_TENANT_ID;
     const clientId = env.AZURE_AD_CLIENT_ID;
     const authScope = buildAzureAuthScope(env.AZURE_AD_AUTH_SCOPE);
     const state = req.query.state as string || crypto.randomBytes(16).toString('hex');
 
     const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
       new URLSearchParams({
         client_id: clientId,
         response_type: 'code',
         redirect_uri: redirectUri,
         scope: authScope,
         response_mode: 'query',
         state: state,
       }).toString();
 
     return res.redirect(authUrl);
   });
 
   r.post("/auth/azure/token", async (req, res) => {
     const code = req.body?.code as string | undefined;
     const defaultRedirect = env.NODE_ENV === 'production' 
       ? 'https://hrms.echt.gh/auth/callback' 
       : 'http://localhost:3000/auth/callback';
     const redirectUri = req.body?.redirect_uri as string || defaultRedirect;
 
     if (!code) {
       return res.status(400).json({ error: 'No authorization code provided' });
     }
 
     try {
       const tenantId = env.AZURE_AD_TENANT_ID;
       const clientId = env.AZURE_AD_CLIENT_ID;
       const clientSecret = env.AZURE_AD_CLIENT_SECRET;
       const authScope = buildAzureAuthScope(env.AZURE_AD_AUTH_SCOPE);
       const tokenResponse = await fetchWithRetry(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/x-www-form-urlencoded',
         },
         body: new URLSearchParams({
           client_id: clientId,
           client_secret: clientSecret,
           grant_type: 'authorization_code',
           code,
           redirect_uri: redirectUri,
           scope: authScope,
         }).toString(),
       });
 
       if (!tokenResponse.ok) {
         const errorData = await tokenResponse.json() as AzureTokenResponse;
         console.error('Azure token exchange failed:', errorData);
         return res.status(tokenResponse.status).json({ 
           error: errorData.error || 'Token exchange failed', 
           description: errorData.error_description 
         });
       }
 
       const tokens = await tokenResponse.json() as AzureTokenResponse;
       return res.json(tokens);
     } catch (error) {
       console.error('Azure token exchange failed:', error);
       return res.status(500).json({ error: 'Token exchange failed' });
     }
   });
 
   r.get("/auth/azure/callback", async (req, res) => {
     const { code, state } = req.query;
     const defaultRedirect = env.NODE_ENV === 'production' 
       ? 'https://hrms.echt.gh/auth/callback' 
       : 'http://localhost:3000/auth/callback';
     const redirectUri = req.query.redirect_uri as string || defaultRedirect;
     
     if (!code) {
       return res.status(400).json({ error: 'No authorization code provided' });
     }
 
     try {
       // Exchange code for tokens
       const tenantId = env.AZURE_AD_TENANT_ID;
        const clientId = env.AZURE_AD_CLIENT_ID;
        const clientSecret = env.AZURE_AD_CLIENT_SECRET;
        const authScope = buildAzureAuthScope(env.AZURE_AD_AUTH_SCOPE);
        const tokenResponse = await fetchWithRetry(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/x-www-form-urlencoded',
         },
         body: new URLSearchParams({
           client_id: clientId,
           client_secret: clientSecret,
           grant_type: 'authorization_code',
           code: code as string,
           redirect_uri: redirectUri,
           scope: authScope,
         }).toString(),
       });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json() as AzureTokenResponse;
        console.error('Token exchange error:', errorData);
        return res.status(tokenResponse.status).json({ 
          error: errorData.error || 'Token exchange failed', 
          description: errorData.error_description 
        });
      }

      const tokens = await tokenResponse.json() as AzureTokenResponse;

      // Check if this is an API request (not a browser redirect)
      const acceptHeader = req.headers.accept || '';
      if (acceptHeader.includes('application/json')) {
        return res.json({
          access_token: tokens.access_token,
          id_token: tokens.id_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type,
          expires_in: tokens.expires_in,
          scope: tokens.scope,
          state: state,
        });
      }

      // Secure Redirect: Use hash fragment instead of query params to prevent token leakage in logs/history
      const frontendUrl = new URL(redirectUri);
      const hashParams = new URLSearchParams();
      hashParams.set('access_token', tokens.access_token);
      if (tokens.id_token) hashParams.set('id_token', tokens.id_token);
      if (state) hashParams.set('state', state as string);
      
      frontendUrl.hash = hashParams.toString();
      
      console.log('Redirecting to frontend with secure hash fragment');
      return res.redirect(frontendUrl.toString());
    } catch (error) {
      console.error('Callback error:', error);
      return res.status(500).json({ error: 'Token exchange failed' });
    }
  });

  r.get("/auth/me", getMe);

  // Authentication
  r.post("/auth/logout", (req, res, next) => void logout(req, res).catch(next));
  r.post("/auth/refresh", requirePermission(Permission.SELF_PROFILE), (_req, res) => {
    // For now, just validate the current token - refresh tokens are handled by Azure AD
    res.json({ message: "Token is valid", valid: true });
  });

  r.get(
    "/audit/logs",
    requirePermission(Permission.AUDIT_READ),
    (req, res, next) => void getAuditLogs(req, res).catch(next),
  );

  // Audit Log endpoint with limit parameter
  r.get(
    "/audit-log",
    requirePermission(Permission.AUDIT_READ),
    (req, res, next) => void getAuditLogs(req, res).catch(next),
  );

  // Admin - Users
  r.get(
    "/users",
    requirePermission(Permission.HR_LEAVE_READ),
    (req, res, next) => void getUsers(req, res).catch(next),
  );
  r.put(
    "/users/:userId/role",
    requirePermission(Permission.SYSTEM_CONFIG),
    (req, res, next) => void updateUserRole(req, res).catch(next),
  );

  // Admin - Role Mappings (Entra Groups to Roles)
  r.get(
    "/admin/role-mappings",
    requirePermission(Permission.SYSTEM_CONFIG),
    (req, res, next) => void getEntraGroupRoleMappings(req, res).catch(next),
  );
  r.post(
    "/admin/role-mappings",
    requirePermission(Permission.SYSTEM_CONFIG),
    (req, res, next) => void createOrUpdateEntraGroupRoleMapping(req, res).catch(next),
  );
  r.delete(
    "/admin/role-mappings/:entraGroupId",
    requirePermission(Permission.SYSTEM_CONFIG),
    (req, res, next) => void deleteEntraGroupRoleMapping(req, res).catch(next),
  );

  // Admin - Token Management
  r.post(
    "/admin/cleanup-tokens",
    requirePermission(Permission.SYSTEM_CONFIG),
    (req, res, next) => void cleanupExpiredTokens(req, res).catch(next),
  );



  // Reports
  r.get("/reports/summary", requirePermission(Permission.REPORTING_READ), (req, res, next) => void getSummary(req, res).catch(next));
  r.get("/reports/attendance", requirePermission(Permission.REPORTING_READ), (req, res, next) => void getAttendanceReport(req, res).catch(next));
  r.get("/reports/leave", requirePermission(Permission.REPORTING_READ), (req, res, next) => void getLeaveReport(req, res).catch(next));

  // Leave Management
  r.get("/leave", requirePermission(Permission.SELF_LEAVE), (req, res, next) => void getAllLeaves(req, res).catch(next));
  r.post("/leave", requirePermission(Permission.SELF_LEAVE), (req, res, next) => void createLeave(req, res).catch(next));
  r.get("/leave/pending-dashboard", requirePermission(Permission.HR_LEAVE_APPROVE), (req, res, next) => void getPendingDashboard(req, res).catch(next));
  r.put("/leave/:id", requirePermission(Permission.SELF_LEAVE), (req, res, next) => void updateLeave(req, res).catch(next));
  r.delete("/leave/:id", requirePermission(Permission.SELF_LEAVE), (req, res, next) => void deleteLeave(req, res).catch(next));
  r.put("/leave/:id/approve", requirePermission(Permission.HR_LEAVE_APPROVE), (req, res, next) => void approveLEave(req, res).catch(next));
  r.put("/leave/:id/reject", requirePermission(Permission.HR_LEAVE_APPROVE), (req, res, next) => void rejectLeave(req, res).catch(next));
  r.put("/leave/:id/return", requirePermission(Permission.HR_LEAVE_APPROVE), (req, res, next) => void returnLeave(req, res).catch(next));
  r.put("/leave/:id/submit", requirePermission(Permission.SELF_LEAVE), (req, res, next) => void submitLeave(req, res).catch(next));

  // Attendance Management
  r.get("/attendance", requirePermission(Permission.SELF_ATTENDANCE), (req, res, next) => void getAllAttendance(req, res).catch(next));
  r.get("/attendance/today", requirePermission(Permission.SELF_ATTENDANCE), (req, res, next) => void getTodayAttendance(req, res).catch(next));
  r.get("/attendance/corrections", requirePermission(Permission.SELF_ATTENDANCE), (req, res, next) => void getCorrections(req, res).catch(next));
  r.post("/attendance/corrections", requirePermission(Permission.SELF_ATTENDANCE), (req, res, next) => void requestCorrection(req, res).catch(next));
  r.post("/attendance/checkin", requirePermission(Permission.SELF_ATTENDANCE), (req, res, next) => void checkIn(req, res).catch(next));
  r.post("/attendance/checkout", requirePermission(Permission.SELF_ATTENDANCE), (req, res, next) => void checkOut(req, res).catch(next));
  r.put("/attendance/corrections/:id/approve", requirePermission(Permission.HR_ATTENDANCE_WRITE), (req, res, next) => void approveCorrection(req, res).catch(next));

  // Original attendance endpoints
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

  // Branches
  r.get("/branches", requirePermission(Permission.HR_LEAVE_READ), (req, res, next) => void getBranches(req, res).catch(next));
  r.post("/branches", requirePermission(Permission.HR_LEAVE_WRITE), (req, res, next) => void createBranch(req, res).catch(next));
  r.put("/branches/:id", requirePermission(Permission.HR_LEAVE_WRITE), (req, res, next) => void updateBranch(req, res).catch(next));
  r.delete("/branches/:id", requirePermission(Permission.HR_LEAVE_WRITE), (req, res, next) => void deleteBranch(req, res).catch(next));

  // HR - Employees 
  r.get("/employees", requirePermission(Permission.HR_LEAVE_READ), (req, res, next) => void getEmployees(req, res).catch(next));
  r.post("/employees", requirePermission(Permission.HR_LEAVE_WRITE), (req, res, next) => void createEmployee(req, res).catch(next));
  r.put("/employees/:id", requirePermission(Permission.HR_LEAVE_WRITE), (req, res, next) => void updateEmployee(req, res).catch(next));
  r.delete("/employees/:id", requirePermission(Permission.HR_LEAVE_WRITE), (req, res, next) => void deleteEmployee(req, res).catch(next));
  r.post("/employees/import", requirePermission(Permission.HR_LEAVE_WRITE), (req, res, next) => void importEmployees(req, res).catch(next));

  // Original leave endpoints
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

  // Finance
  r.get("/finance/requests", requirePermission(Permission.FINANCE_READ), (req, res, next) => void getFinanceRequests(req, res).catch(next));
  r.post("/finance/requests", requirePermission(Permission.FINANCE_WRITE), (req, res, next) => void createFinanceRequest(req, res).catch(next));
  r.put("/finance/requests/:id/approve", requirePermission(Permission.FINANCE_APPROVE), (req, res, next) => void approveFinanceRequest(req, res).catch(next));
  r.put("/finance/requests/:id/reject", requirePermission(Permission.FINANCE_APPROVE), (req, res, next) => void rejectFinanceRequest(req, res).catch(next));

  // IT Tickets
  r.get("/tickets", requirePermission(Permission.IT_TICKET_READ_ALL), (req, res, next) => void getTickets(req, res).catch(next));
  r.post("/tickets", requirePermission(Permission.IT_TICKET_WRITE), (req, res, next) => void createTicket(req, res).catch(next));
  r.put("/tickets/:id", requirePermission(Permission.IT_TICKET_WRITE), (req, res, next) => void updateTicket(req, res).catch(next));
  r.delete("/tickets/:id", requirePermission(Permission.IT_TICKET_WRITE), (req, res, next) => void deleteTicket(req, res).catch(next));
  r.get("/it/queues", requirePermission(Permission.IT_TICKET_READ_ALL), (req, res, next) => void getQueues(req, res).catch(next));

  // Operations - Clients
  r.get("/clients", requirePermission(Permission.OPS_READ), (req, res, next) => void getClients(req, res).catch(next));
  r.post("/clients", requirePermission(Permission.OPS_WRITE), (req, res, next) => void createClient(req, res).catch(next));
  r.put("/clients/:id", requirePermission(Permission.OPS_WRITE), (req, res, next) => void updateClient(req, res).catch(next));
  r.delete("/clients/:id", requirePermission(Permission.OPS_WRITE), (req, res, next) => void deleteClient(req, res).catch(next));

  // Operations - Conversations
  r.get("/conversations", requirePermission(Permission.OPS_READ), (req, res, next) => void getConversations(req, res).catch(next));
  r.post("/conversations", requirePermission(Permission.OPS_WRITE), (req, res, next) => void createConversation(req, res).catch(next));

  // Notifications
  r.get("/notifications", requirePermission(Permission.SELF_PROFILE), (req, res, next) => void getNotifications(req, res).catch(next));
  r.put("/notifications/:id/read", requirePermission(Permission.SELF_PROFILE), (req, res, next) => void markAsRead(req, res).catch(next));
  r.put("/notifications/read-all", requirePermission(Permission.SELF_PROFILE), (req, res, next) => void markAllAsRead(req, res).catch(next));

  return r;
}
