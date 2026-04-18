# REST API route map — Echt HR & Process Automation Platform

Base URL: `/api/v1` (JWT required except platform `/health`).

Auth: `Authorization: Bearer <Entra access token for API audience>`.  
Optional tracing: `X-Correlation-Id: <uuid>`.

---

## Legend

| Guard        | Meaning                                              |
| ------------ | ---------------------------------------------------- |
| `JWT`        | Valid Entra JWT                                      |
| `RBAC(key)`  | `requirePermission` — see `src/config/permissions.ts` |
| `HR_SENS`    | GPS / location audit (`HR_ATTENDANCE_READ_SENSITIVE`) |

---

## Platform

| Method | Path       | Auth | Description        |
| ------ | ---------- | ---- | ------------------ |
| GET    | `/health`  | none | Liveness for LB/k8s |

---

## Identity & audit

| Method | Path              | Auth        | RBAC               | Description                    |
| ------ | ----------------- | ----------- | ------------------ | ------------------------------ |
| GET    | `/me`             | JWT         | `SELF_PROFILE`     | Token claims + resolved roles  |
| GET    | `/audit/logs`     | JWT         | `AUDIT_READ`       | Paginated immutable audit trail |

**GET `/audit/logs` query:** `resourceType`, `resourceId`, `actorUserId`, `action`, `from`, `to`, `take`, `skip`.

Example response:

```json
{
  "items": [
    {
      "id": "1",
      "action": "workflow.transition",
      "resourceType": "WorkflowInstance",
      "resourceId": "…",
      "before": { "state": "DRAFT" },
      "after": { "state": "SUBMITTED" },
      "createdAt": "2026-04-18T10:00:00.000Z",
      "actor": { "email": "user@echt.com", "displayName": "A. User" }
    }
  ],
  "total": 1
}
```

---

## HR — Leave

| Method | Path            | Auth | RBAC           | Description                |
| ------ | --------------- | ---- | -------------- | -------------------------- |
| POST   | `/hr/leave`     | JWT  | `SELF_LEAVE`   | Create leave + workflow    |
| GET    | `/hr/leave/me`  | JWT  | `SELF_LEAVE`   | List caller’s leave rows   |

**POST `/hr/leave` body:**

```json
{
  "leaveTypeId": "uuid",
  "startDate": "2026-05-01",
  "endDate": "2026-05-05",
  "workingDays": 3,
  "reason": "optional"
}
```

**Response (201):** `{ "leave": { … }, "workflowId": "uuid" }`

---

## Attendance & GPS

| Method | Path                                   | Auth | RBAC                    | Description                          |
| ------ | -------------------------------------- | ---- | ----------------------- | ------------------------------------ |
| POST   | `/attendance/clock`                    | JWT  | `SELF_ATTENDANCE`       | Single clock-in/out (online)         |
| POST   | `/attendance/clock/sync`             | JWT  | `SELF_ATTENDANCE`       | Batch offline sync (max 50)          |
| GET    | `/attendance/users/:userId/clock-events` | JWT  | `HR_SENS` | Location audit (lat/lng, distance) |

**POST `/attendance/clock` body:**

```json
{
  "branchId": "uuid",
  "type": "CLOCK_IN",
  "latitude": 5.6037,
  "longitude": -0.187,
  "accuracyM": 12.5,
  "clientTimestamp": "2026-04-18T08:01:00.000Z",
  "idempotencyKey": "uuid-optional",
  "source": "ONLINE"
}
```

**Response:** `{ "status": "created"|"duplicate_ignored", "event": { … }, "geofence": { … } }`

---

## IT / Finance / Ops / Payroll / Reporting (stubs)

| Method | Path                 | Auth | RBAC                     |
| ------ | -------------------- | ---- | ------------------------ |
| GET    | `/it/tickets`        | JWT  | `IT_TICKET_READ_ALL`    |
| GET    | `/finance/requests` | JWT  | `FINANCE_READ`           |
| GET    | `/ops/pipeline`      | JWT  | `OPS_READ`               |
| GET    | `/payroll/runs`      | JWT  | `HR_PAYROLL_READ`        |
| GET    | `/reports/summary`   | JWT  | `REPORTING_READ`         |

Extend these paths per SRS (`FR-IT-*`, `FR-FIN-*`, `FR-OPS-*`, payroll exports) using the same `requirePermission` pattern as in `src/routes/v1/index.ts`.

---

## Suggested additional routes (implement next)

| Module   | Method | Path example                         | RBAC / notes                    |
| -------- | ------ | ------------------------------------ | ------------------------------- |
| HR       | GET    | `/hr/leave-types`                    | read: HR/Manager; write: HR    |
| HR       | POST   | `/hr/leave/:id/approve`              | `HR_LEAVE_APPROVE` / Manager    |
| HR       | GET    | `/hr/appraisals/cycles`             | `HR_APPRAISAL_READ`             |
| Payroll  | POST   | `/payroll/runs/:id/lock`             | `HR_PAYROLL_WRITE`              |
| Payroll  | PATCH  | `/payroll/lines/:id/deductions/:d`   | `HR_PAYROLL_OVERRIDE` + audit   |
| IT       | POST   | `/it/tickets`                        | `IT_TICKET_WRITE`               |
| Finance  | POST   | `/finance/requests`                  | `FINANCE_WRITE` / approve chain |
| Ops      | POST   | `/ops/clients`                       | `OPS_WRITE`                     |
| Admin    | CRUD   | `/admin/entra-group-maps`            | `SUPER_ADMIN` only             |
| Notify   | GET/PUT| `/notifications/preferences`       | `NOTIFICATION_CONFIG` / self    |
