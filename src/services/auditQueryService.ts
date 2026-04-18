import type { Prisma, PrismaClient } from "@prisma/client";

export type AuditQuery = {
  resourceType?: string;
  resourceId?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  action?: string;
  take?: number;
  skip?: number;
};

/**
 * Compliance reporting interface — read-only, paginated, indexed by resource + time.
 */
export class AuditQueryService {
  constructor(private readonly db: PrismaClient) {}

  async search(q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (q.resourceType) where.resourceType = q.resourceType;
    if (q.resourceId) where.resourceId = q.resourceId;
    if (q.actorUserId) where.actorUserId = q.actorUserId;
    if (q.action) where.action = q.action;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = q.from;
      if (q.to) where.createdAt.lte = q.to;
    }

    const [items, total] = await this.db.$transaction([
      this.db.auditLog.findMany({
        where,
        orderBy: { id: "desc" },
        take: q.take ?? 100,
        skip: q.skip ?? 0,
        include: { actor: { select: { email: true, displayName: true } } },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
