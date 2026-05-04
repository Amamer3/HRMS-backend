import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError } from "../lib/errors.js";

const financeRequests = new Map<string, any>();

export const getFinanceRequests = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query;
  let all = Array.from(financeRequests.values());
  if (status) all = all.filter(f => Array.isArray(status) ? status.includes(f.status) : f.status === status);
  res.json(all);
});

export const createFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const id = randomUUID();
  const request = {
    id,
    employeeId: req.userId,
    ...req.body,
    status: "PENDING",
    createdAt: new Date(),
  };
  financeRequests.set(id, request);
  res.status(201).json(request);
});

export const approveFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const request = financeRequests.get(id);
  if (!request) {
    throw new NotFoundError("Finance request not found");
  }
  request.status = "APPROVED";
  res.json(request);
});

export const rejectFinanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const request = financeRequests.get(id);
  if (!request) {
    throw new NotFoundError("Finance request not found");
  }
  request.status = "REJECTED";
  res.json(request);
});
