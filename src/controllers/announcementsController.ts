import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";

/**
 * Get the latest 5 public announcements.
 */
export const getLatestAnnouncements = asyncHandler(async (_req: Request, res: Response) => {
  const announcements = await prisma.announcement.findMany({
    where: {
      isPublic: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 5,
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
      author: {
        select: {
          displayName: true
        }
      }
    }
  });

  res.json(announcements);
});

/**
 * Admin: Create a new announcement.
 */
export const createAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const { title, content, isPublic, expiresAt } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: "Title and content are required" });
  }

  const announcement = await prisma.announcement.create({
    data: {
      title,
      content,
      isPublic: isPublic ?? true,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      authorId: req.userId || null
    }
  });

  return res.status(201).json(announcement);
});
