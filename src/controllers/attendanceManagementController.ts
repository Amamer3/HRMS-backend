import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

const attendanceRecords = new Map<string, any>();
const corrections = new Map<string, any>();

export async function getAllAttendance(req: Request, res: Response) {
  const { employeeId } = req.query;
  const records = Array.from(attendanceRecords.values());
  const filtered = employeeId ? records.filter(r => r.employeeId === employeeId) : records;
  res.json(filtered);
}

export async function getTodayAttendance(_req: Request, res: Response) {
  const today = new Date().toISOString().split("T")[0];
  const records = Array.from(attendanceRecords.values()).filter(r => r.date === today);
  res.json(records);
}

export async function getCorrections(req: Request, res: Response) {
  const { status } = req.query;
  const all = Array.from(corrections.values());
  const filtered = status ? (Array.isArray(status) ? all.filter(c => status.includes(c.status)) : all.filter(c => c.status === status)) : all;
  res.json(filtered);
}

export async function requestCorrection(req: Request, res: Response) {
  const { employeeId, date, reason } = req.body;
  const id = randomUUID();
  const correction = {
    id,
    employeeId,
    date,
    reason,
    status: "PENDING",
    createdAt: new Date(),
  };
  corrections.set(id, correction);
  res.status(201).json(correction);
}

export async function checkIn(req: Request, res: Response) {
  const { branchId, latitude, longitude, accuracyM, clientTimestamp } = req.body;
  const record = {
    id: randomUUID(),
    employeeId: (req as any).user?.id,
    branchId,
    type: "CLOCK_IN",
    latitude,
    longitude,
    accuracyM,
    clientTimestamp,
    createdAt: new Date(),
  };
  res.json({ success: true, record });
}

export async function checkOut(req: Request, res: Response) {
  const { branchId, latitude, longitude, accuracyM, clientTimestamp } = req.body;
  const record = {
    id: randomUUID(),
    employeeId: (req as any).user?.id,
    branchId,
    type: "CLOCK_OUT",
    latitude,
    longitude,
    accuracyM,
    clientTimestamp,
    createdAt: new Date(), 
  };
  res.json({ success: true, record });
}

export async function approveCorrection(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const correction = corrections.get(id);
  if (!correction) {
    res.status(404).json({ error: "Correction not found" });
    return;
  }
  
  correction.status = "APPROVED";
  res.json(correction);
}
