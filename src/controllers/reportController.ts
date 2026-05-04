import { Request, Response } from "express";

export async function getSummary(_req: Request, res: Response) {
  res.json({
    totalEmployees: 150,
    presentToday: 142,
    absentToday: 5,
    onLeaveToday: 3,
    upcomingBirthdays: 8,
  });
}

export async function getAttendanceReport(_req: Request, res: Response) {
  res.json([
    {
      date: new Date().toISOString().split("T")[0],
      presentCount: 142,
      absentCount: 5,
      lateCount: 12,
    },
  ]);
}

export async function getLeaveReport(_req: Request, res: Response) {
  res.json([
    {
      leaveType: "Annual Leave",
      taken: 8,
      remaining: 12,
      approved: 8,
      pending: 0,
    },
    {
      leaveType: "Sick Leave",
      taken: 3,
      remaining: 7,
      approved: 3,
      pending: 0,
    },
  ]);
}

export async function getPayrollReport(_req: Request, res: Response) {
  const now = new Date();
  res.json({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    totalEmployees: 150,
    totalAmount: 2500000,
    processedCount: 145,
    pendingCount: 5,
  });
}
