import { Request, Response } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError } from "../lib/errors.js";

const notifications = new Map<string, any>();

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId;
  const { isRead } = req.query;
  
  let all = Array.from(notifications.values()).filter(n => n.userId === userId);
  if (isRead !== undefined) {
    all = all.filter(n => n.isRead === (isRead === "true"));
  }
  res.json(all);
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const notification = notifications.get(id);
  if (!notification) {
    throw new NotFoundError("Notification not found");
  }
  notification.isRead = true;
  res.json(notification);
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId;
  const userNotifications = Array.from(notifications.values()).filter(n => n.userId === userId);
  userNotifications.forEach(n => n.isRead = true);
  res.json({ marked: userNotifications.length });
});
