import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { isRead } = req.query;
  
  const allNotifications = await prisma.inAppNotification.findMany({
    where: {
      userId,
      ...(isRead !== undefined && {
        readAt: isRead === "true" ? { not: null } : null,
      }),
    },
    orderBy: { createdAt: "desc" },
  });
  
  res.json(allNotifications);
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const notification = await prisma.inAppNotification.update({
    where: { id },
    data: { readAt: new Date() },
  });
  res.json(notification);
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const result = await prisma.inAppNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ marked: result.count });
});
