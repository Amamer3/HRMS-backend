import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export async function getSummary(_req: Request, res: Response) {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

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

export async function getAttendanceReport(req: Request, res: Response) {
  try {
    const { start_date, end_date } = req.query;
    
    const start = start_date ? new Date(start_date as string) : new Date();
    const end = end_date ? new Date(end_date as string) : new Date();
    
    if (!start_date) start.setDate(start.getDate() - 7); // Default to last 7 days

    const sessions = await prisma.attendanceSession.findMany({
      where: {
        workDate: {
          gte: start,
          lte: end,
        },
      },
      include: {
        branch: true,
        events: {
          orderBy: { clientTimestamp: "asc" },
        },
      },
    });

    const totalEmployees = await prisma.user.count({
      where: { isActive: true },
    });

    // Group by date
    const dailyStats: Record<string, { date: string; presentCount: number; lateCount: number; absentCount: number }> = {};

    // Initialize dailyStats for the range
    let curr = new Date(start);
    while (curr <= end) {
      const d = curr.toISOString().split("T")[0];
      dailyStats[d] = { date: d, presentCount: 0, lateCount: 0, absentCount: totalEmployees };
      curr.setDate(curr.getDate() + 1);
    }

    for (const session of sessions) {
      const d = session.workDate.toISOString().split("T")[0];
      if (dailyStats[d]) {
        dailyStats[d].presentCount++;
        dailyStats[d].absentCount--;

        const clockIn = session.events.find(e => e.type === "CLOCK_IN" && e.accepted);
        if (clockIn) {
          const [startHour, startMin] = session.branch.workdayStartLocal.split(":").map(Number);
          const checkInTime = clockIn.clientTimestamp;
          const scheduledStart = new Date(checkInTime);
          scheduledStart.setUTCHours(startHour, startMin, 0, 0);

          if (checkInTime > scheduledStart) {
            const minutesLate = (checkInTime.getTime() - scheduledStart.getTime()) / (1000 * 60);
            if (minutesLate > session.branch.lateGraceMinutes) {
              dailyStats[d].lateCount++;
            }
          }
        }
      }
    }

    res.json(Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date)));
  } catch (error) {
    console.error("Failed to fetch attendance report:", error);
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
