import type { PrismaClient } from "@prisma/client";
import { appendAuditLog } from "../middleware/auditMiddleware.js";
import type { Request } from "express";

/** Inferred from the client delegate — avoids importing enum types that some TS setups fail to resolve from `@prisma/client`. */
type WorkflowRow = NonNullable<Awaited<ReturnType<PrismaClient["workflowInstance"]["findFirst"]>>>;
type WorkflowModule = WorkflowRow["module"];
type WorkflowState = WorkflowRow["currentState"];

/**
 * Configurable transitions per module. Extend with DB-driven rules later without redesign (NFR-10/11).
 * States align with SRS: Draft → Submitted → … (+ Rejected, Cancelled, On Hold, Returned).
 */
const TRANSITIONS: Partial<Record<
  WorkflowModule,
  Partial<Record<WorkflowState, WorkflowState[]>>
>> = {
  HR_LEAVE: {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["PENDING_APPROVAL", "RETURNED", "CANCELLED"],
    PENDING_APPROVAL: ["IN_PROGRESS", "REJECTED", "ON_HOLD", "RETURNED"],
    IN_PROGRESS: ["COMPLETED", "ON_HOLD", "RETURNED"],
    COMPLETED: ["PENDING_REQUESTER_CONFIRMATION"],
    PENDING_REQUESTER_CONFIRMATION: ["CLOSED", "RETURNED"],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
    ON_HOLD: ["PENDING_APPROVAL", "IN_PROGRESS"],
    RETURNED: ["SUBMITTED", "CANCELLED"],
  },
  HR_ATTENDANCE_ADJUSTMENT: {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["PENDING_APPROVAL", "CANCELLED"],
    PENDING_APPROVAL: ["IN_PROGRESS", "REJECTED"],
    IN_PROGRESS: ["COMPLETED", "CLOSED"],
    COMPLETED: ["CLOSED"],
    PENDING_REQUESTER_CONFIRMATION: ["CLOSED"],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
    ON_HOLD: ["IN_PROGRESS"],
    RETURNED: ["SUBMITTED"],
  },
  IT_TICKET: {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["IN_PROGRESS", "PENDING_APPROVAL"],
    PENDING_APPROVAL: ["IN_PROGRESS", "REJECTED"],
    IN_PROGRESS: ["COMPLETED", "ON_HOLD", "PENDING_REQUESTER_CONFIRMATION"],
    COMPLETED: ["CLOSED"],
    PENDING_REQUESTER_CONFIRMATION: ["CLOSED", "RETURNED"],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
    ON_HOLD: ["IN_PROGRESS"],
    RETURNED: ["IN_PROGRESS"],
  },
  FINANCE_REQUEST: {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["PENDING_APPROVAL"],
    PENDING_APPROVAL: ["IN_PROGRESS", "REJECTED", "ON_HOLD"],
    IN_PROGRESS: ["COMPLETED"],
    COMPLETED: ["PENDING_REQUESTER_CONFIRMATION"],
    PENDING_REQUESTER_CONFIRMATION: ["CLOSED", "RETURNED"],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
    ON_HOLD: ["PENDING_APPROVAL"],
    RETURNED: ["SUBMITTED"],
  },
  OPS_CLIENT: {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["IN_PROGRESS"],
    IN_PROGRESS: ["COMPLETED", "CLOSED"],
    COMPLETED: ["CLOSED"],
    PENDING_APPROVAL: [],
    PENDING_REQUESTER_CONFIRMATION: [],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
    ON_HOLD: [],
    RETURNED: [],
  },
  OPS_PIPELINE: {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["PENDING_APPROVAL"],
    PENDING_APPROVAL: ["IN_PROGRESS", "REJECTED"],
    IN_PROGRESS: ["COMPLETED", "ON_HOLD"],
    COMPLETED: ["CLOSED"],
    PENDING_REQUESTER_CONFIRMATION: ["CLOSED"],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
    ON_HOLD: ["IN_PROGRESS"],
    RETURNED: ["SUBMITTED"],
  },
};

export class WorkflowEngine {
  constructor(private readonly db: PrismaClient) {}

  allowedNextStates(module: WorkflowModule, from: WorkflowState): WorkflowState[] {
    return TRANSITIONS[module]?.[from] ?? [];
  }

  /**
   * Atomic transition + history row. SLA hooks: recompute `slaDueAt` when entering pending states.
   */
  async transition(req: Request, input: {
    workflowId: string;
    to: WorkflowState;
    comment?: string;
    routingStep?: string;
  }) {
    const wf = await this.db.workflowInstance.findUniqueOrThrow({
      where: { id: input.workflowId },
    });

    const allowed = this.allowedNextStates(wf.module, wf.currentState);
    if (!allowed.includes(input.to)) {
      throw Object.assign(new Error("Illegal transition"), { code: "WORKFLOW_ILLEGAL_TRANSITION" });
    }

    const from = wf.currentState;
    const slaDueAt = this.maybeExtendSla(wf, input.to);

    const [updated] = await this.db.$transaction([
      this.db.workflowInstance.update({
        where: { id: wf.id },
        data: {
          currentState: input.to,
          slaDueAt,
          updatedAt: new Date(),
        },
      }),
      this.db.workflowTransition.create({
        data: {
          workflowInstanceId: wf.id,
          fromState: from,
          toState: input.to,
          actorUserId: req.userId ?? null,
          comment: input.comment,
          routingStep: input.routingStep,
        },
      }),
    ]);

    await appendAuditLog(req, {
      action: "workflow.transition",
      resourceType: "WorkflowInstance",
      resourceId: wf.id,
      before: { state: from },
      after: { state: input.to, routingStep: input.routingStep },
    });

    return updated;
  }

  private maybeExtendSla(wf: { slaDueAt: Date | null }, to: WorkflowState): Date | null {
    if (to === "PENDING_APPROVAL" || to === "PENDING_REQUESTER_CONFIRMATION") {
      const base = wf.slaDueAt ?? new Date();
      const next = new Date(base);
      next.setHours(next.getHours() + 48);
      return next;
    }
    return wf.slaDueAt;
  }
}
