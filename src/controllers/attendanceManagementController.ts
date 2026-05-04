import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export async function getAllAttendance(req: Request, res: Response) {
  try {
    const { date } = req.query;
    const workDate = date ? new Date(date as string) : new Date();
    workDate.setUTCHours(0, 0, 0, 0);

    const sessions = await prisma.attendanceSession.findMany({
      where: {
        workDate,
      },
      include: {
        user: {
          select: {
            displayName: true,
            email: true,
          },
        },
        branch: true,
        events: {
          orderBy: { clientTimestamp: "asc" },
        },
      },
    });

    const formatted = sessions.map((session) => {
      const clockIn = session.events.find((e) => e.type === "CLOCK_IN" && e.accepted);
      const clockOut = session.events.find((e) => e.type === "CLOCK_OUT" && e.accepted);

      let minutesLate = 0;
      let isLate = false;

      if (clockIn) {
        const [startHour, startMin] = session.branch.workdayStartLocal.split(":").map(Number);
        const checkInTime = clockIn.clientTimestamp;
        const scheduledStart = new Date(checkInTime);
        scheduledStart.setUTCHours(startHour, startMin, 0, 0);

        if (checkInTime > scheduledStart) {
          minutesLate = Math.floor((checkInTime.getTime() - scheduledStart.getTime()) / (1000 * 60));
          if (minutesLate > session.branch.lateGraceMinutes) {
            isLate = true;
          }
        }
      }

      return {
        id: session.id,
        employee_name: session.user.displayName,
        employee_email: session.user.email,
        check_in_time: clockIn?.clientTimestamp,
        check_out_time: clockOut?.clientTimestamp,
        status: session.status,
        is_late: isLate,
        minutes_late: minutesLate,
        geofence_status: clockIn?.accepted ? "inside" : "outside",
        branch_name: session.branch.name,
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error("Failed to fetch all attendance:", error);
    res.status(500).json({ error: "Failed to fetch attendance records" });
  }
}

export async function getCorrections(_req: Request, res: Response) {
  try {
    const corrections = await (prisma as any).attendanceAdjustment.findMany({
      include: {
        user: {
          select: {
            displayName: true,
            email: true,
          },
        },
        workflowInstance: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = corrections.map((c: any) => ({
      id: c.id,
      employee_name: c.user.displayName,
      employee_email: c.user.email,
      missed_date: c.workDate.toISOString().split("T")[0],
      reason: c.reason,
      status: c.workflowInstance.currentState,
      createdAt: c.createdAt,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch corrections" });
  }
}

export async function approveCorrection(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    
    const adjustment = await (prisma as any).attendanceAdjustment.findUnique({
      where: { id },
      include: { workflowInstance: true },
    });

    if (!adjustment) {
      res.status(404).json({ error: "Correction not found" });
      return;
    }

    // Update workflow state
    await prisma.workflowInstance.update({
      where: { id: adjustment.workflowInstanceId },
      data: { currentState: "COMPLETED" },
    });

    // In a real app, this might also create a "Correction" type clock event
    // for simplicity, we just mark the adjustment as approved

    res.json({ message: "Correction approved", adjustment });
  } catch (error) {
    res.status(500).json({ error: "Failed to approve correction" });
  }
}

export async function rejectCorrection(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };

    const adjustment = await (prisma as any).attendanceAdjustment.findUnique({
      where: { id },
      include: { workflowInstance: true },
    });

    if (!adjustment) {
      res.status(404).json({ error: "Correction not found" });
      return;
    }

    // Update workflow state
    await prisma.workflowInstance.update({
      where: { id: adjustment.workflowInstanceId },
      data: { currentState: "REJECTED" },
    });

    res.json({ message: "Correction rejected", adjustment });
  } catch (error) {
    res.status(500).json({ error: "Failed to reject correction" });
  }
}
