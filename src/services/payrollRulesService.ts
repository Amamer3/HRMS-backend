import type { PrismaClient } from "@prisma/client";

/**
 * Business rules (Ghana ops):
 * - 3 lates in a calendar month → auto 1-day deduction
 * - 6 lates → escalation flag (HR review) — stored on MonthlyLateSummary
 * - Each unapproved absence → 1-day deduction
 * All lines overridable by HR Admin before export; overrides audited separately.
 */
export class PayrollRulesService {
  constructor(private readonly db: PrismaClient) {}

  async applyLateRulesForMonth(userId: string, year: number, month: number) {
    const summary = await this.db.monthlyLateSummary.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: { userId, year, month, lateCount: 0, flaggedEscalation: false },
      update: {},
    });

    let deductionDays = 0;
    if (summary.lateCount >= 3) {
      deductionDays += 1;
    }
    const flaggedEscalation = summary.lateCount >= 6;

    await this.db.monthlyLateSummary.update({
      where: { id: summary.id },
      data: { flaggedEscalation },
    });

    return { deductionDays, flaggedEscalation, lateCount: summary.lateCount };
  }

  async incrementLate(userId: string, day: Date) {
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const summary = await this.db.monthlyLateSummary.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: { userId, year, month, lateCount: 1, flaggedEscalation: false },
      update: { lateCount: { increment: 1 } },
    });
    return summary;
  }
}
