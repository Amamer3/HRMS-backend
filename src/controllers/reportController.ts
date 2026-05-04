import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export async function getSummary(_req: Request, res: Response) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalEmployees = await prisma.user.count({
      where: { isActive: true },
    });

    const presentToday = await prisma.attendanceSession.count({
      where: {
        workDate: today,
      },
    });

    const onLeaveToday = await prisma.leaveRequest.count({
      where: {
        startDate: { lte: today },
        endDate: { gte: today },
        workflowInstance: {
          currentState: "COMPLETED",
        },
      },
    });

    const absentToday = Math.max(0, totalEmployees - presentToday - onLeaveToday);

    res.json({
      totalEmployees,
      presentToday,
      absentToday,
      onLeaveToday,
    });
  } catch (error) {
    console.error("Failed to fetch report summary:", error);
    res.status(500).json({ error: "Failed to fetch report summary" });
  }
}

export async function getAttendanceReport(_req: Request, res: Response) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalEmployees = await prisma.user.count({
      where: { isActive: true },
    });

    const presentCount = await prisma.attendanceSession.count({
      where: {
        workDate: today,
      },
    });

    const onLeaveToday = await prisma.leaveRequest.count({
      where: {
        startDate: { lte: today },
        endDate: { gte: today },
        workflowInstance: {
          currentState: "COMPLETED",
        },
      },
    });

    const absentCount = Math.max(0, totalEmployees - presentCount - onLeaveToday);

    res.json([
      {
        date: today.toISOString().split("T")[0],
        presentCount,
        absentCount,
        lateCount: 0, // Placeholder as specific late logic requires branch config comparison
      },
    ]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch attendance report" });
  }
}

export async function getLeaveReport(_req: Request, res: Response) {
  try {
    const leaveTypes = await prisma.leaveType.findMany({
      include: {
        _count: {
          select: { requests: true },
        },
      },
    });

    const report = await Promise.all(
      leaveTypes.map(async (lt) => {
        const approvedRequests = await prisma.leaveRequest.findMany({
          where: {
            leaveTypeId: lt.id,
            workflowInstance: {
              currentState: "COMPLETED",
            },
          },
          select: {
            workingDays: true,
          },
        });

        const pendingRequests = await prisma.leaveRequest.findMany({
          where: {
            leaveTypeId: lt.id,
            workflowInstance: {
              currentState: { in: ["SUBMITTED", "PENDING_APPROVAL"] },
            },
          },
        });

        const taken = approvedRequests.reduce((sum, r) => sum + Number(r.workingDays), 0);

        return {
          leaveType: lt.name,
          taken,
          remaining: Number(lt.maxDaysPerYear || 0) - taken,
          approved: approvedRequests.length,
          pending: pendingRequests.length,
        };
      })
    );

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch leave report" });
  }
}
