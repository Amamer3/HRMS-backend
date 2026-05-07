import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { ConflictError } from "../lib/errors.js";

type LeaveBalanceDb = Pick<PrismaClient, "leaveType" | "leaveBalance">;

function calendarYearUtc(d: Date): number {
  return d.getUTCFullYear();
}

export function remainingDays(balance: {
  openingBalanceDays: Prisma.Decimal;
  accruedDays: Prisma.Decimal;
  adjustedDays: Prisma.Decimal;
  usedDays: Prisma.Decimal;
}): Prisma.Decimal {
  return balance.openingBalanceDays
    .plus(balance.accruedDays)
    .plus(balance.adjustedDays)
    .minus(balance.usedDays);
}

/**
 * Creates yearly opening balances for every leave type that has a yearly cap (including the default 15-day annual pool).
 */
export async function seedYearlyLeaveBalancesForUser(
  db: PrismaClient,
  userId: string,
  year: number = new Date().getUTCFullYear(),
): Promise<void> {
  const types = await db.leaveType.findMany({
    where: { maxDaysPerYear: { not: null } },
  });

  for (const lt of types) {
    const opening = lt.maxDaysPerYear!;
    await db.leaveBalance.upsert({
      where: {
        userId_leaveTypeId_year: {
          userId,
          leaveTypeId: lt.id,
          year,
        },
      },
      create: {
        userId,
        leaveTypeId: lt.id,
        year,
        openingBalanceDays: opening,
        accruedDays: new Prisma.Decimal(0),
        usedDays: new Prisma.Decimal(0),
        adjustedDays: new Prisma.Decimal(0),
      },
      update: {},
    });
  }
}

async function getOrCreateBalance(
  tx: LeaveBalanceDb,
  userId: string,
  leaveTypeId: string,
  year: number,
) {
  const leaveType = await tx.leaveType.findUniqueOrThrow({
    where: { id: leaveTypeId },
  });

  if (leaveType.maxDaysPerYear === null) {
    throw new ConflictError("This leave type does not use the yearly balance pool");
  }

  const balance = await tx.leaveBalance.upsert({
    where: {
      userId_leaveTypeId_year: {
        userId,
        leaveTypeId,
        year,
      },
    },
    create: {
      userId,
      leaveTypeId,
      year,
      openingBalanceDays: leaveType.maxDaysPerYear,
      accruedDays: new Prisma.Decimal(0),
      usedDays: new Prisma.Decimal(0),
      adjustedDays: new Prisma.Decimal(0),
    },
    update: {},
  });

  return { balance };
}

export async function assertLeaveBalanceCoversRequest(
  db: PrismaClient,
  input: {
    userId: string;
    leaveTypeId: string;
    startDate: Date;
    workingDays: Prisma.Decimal | number;
  },
): Promise<void> {
  const leaveType = await db.leaveType.findUnique({
    where: { id: input.leaveTypeId },
  });
  if (!leaveType || leaveType.maxDaysPerYear === null) {
    return;
  }

  const year = calendarYearUtc(input.startDate);
  const days = typeof input.workingDays === "number"
    ? new Prisma.Decimal(input.workingDays)
    : input.workingDays;

  const { balance } = await getOrCreateBalance(db, input.userId, input.leaveTypeId, year);
  const left = remainingDays(balance);
  if (left.lessThan(days)) {
    throw new ConflictError(
      `Insufficient leave balance for ${leaveType.name}. Remaining: ${left.toFixed(2)} day(s); requested: ${days.toFixed(2)}.`,
      { remaining: left.toNumber(), requested: days.toNumber() },
    );
  }
}

/**
 * On approval, deduct working days from the employee's balance for that leave type and year (idempotent per request).
 */
export async function debitLeaveBalanceOnApproval(
  db: PrismaClient,
  leaveRequestId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { leaveType: true },
    });

    if (!leave) {
      return;
    }

    if (leave.leaveType.maxDaysPerYear === null) {
      return;
    }

    const year = calendarYearUtc(leave.startDate);
    const existingDebit = await tx.leaveLedgerEntry.findFirst({
      where: {
        leaveRequestId,
        direction: "DEBIT",
      },
    });
    if (existingDebit) {
      return;
    }

    const { balance } = await getOrCreateBalance(tx, leave.userId, leave.leaveTypeId, year);
    const left = remainingDays(balance);
    if (left.lessThan(leave.workingDays)) {
      throw new ConflictError(
        `Cannot approve: insufficient leave balance. Remaining: ${left.toFixed(2)} day(s); requested: ${leave.workingDays.toFixed(2)}.`,
        { remaining: left.toNumber(), requested: leave.workingDays.toNumber() },
      );
    }

    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: {
        usedDays: { increment: leave.workingDays },
      },
    });

    await tx.leaveLedgerEntry.create({
      data: {
        userId: leave.userId,
        leaveTypeId: leave.leaveTypeId,
        leaveRequestId: leave.id,
        year,
        direction: "DEBIT",
        days: leave.workingDays,
        note: "Approved leave request",
      },
    });
  });
}
