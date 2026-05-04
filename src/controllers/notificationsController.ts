import { Request, Response } from "express";

const notifications = new Map<string, any>();

export async function getNotifications(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  const { isRead } = req.query;
  
  let all = Array.from(notifications.values()).filter(n => n.userId === userId);
  if (isRead !== undefined) {
    all = all.filter(n => n.isRead === (isRead === "true"));
  }
  res.json(all);
}

export async function markAsRead(req: Request, res: Response) {
  const id = req.params.id as string;
  const notification = notifications.get(id);
  if (!notification) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  notification.isRead = true;
  res.json(notification);
}

export async function markAllAsRead(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  const userNotifications = Array.from(notifications.values()).filter(n => n.userId === userId);
  userNotifications.forEach(n => n.isRead = true);
  res.json({ marked: userNotifications.length });
}
