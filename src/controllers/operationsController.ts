import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const getClients = asyncHandler(async (_req: Request, res: Response) => {
  const allClients = await prisma.clientAccount.findMany({
    include: {
      pipelineDeals: true,
      conversations: true,
    },
    orderBy: { name: "asc" },
  });
  res.json(allClients);
});

export const createClient = asyncHandler(async (req: Request, res: Response) => {
  const { name, code } = req.body;
  const client = await prisma.clientAccount.create({
    data: {
      name,
      code,
    },
  });
  res.status(201).json(client);
});

export const updateClient = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, code } = req.body;
  const client = await prisma.clientAccount.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code }),
    },
  });
  res.json(client);
});

export const deleteClient = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await prisma.clientAccount.delete({
    where: { id },
  });
  res.status(204).send();
});

export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  const { client_id } = req.query;
  const allConversations = await prisma.clientConversation.findMany({
    where: {
      ...(client_id && { clientId: client_id as string }),
    },
    include: {
      client: true,
    },
    orderBy: { occurredAt: "desc" },
  });
  res.json(allConversations);
});

export const createConversation = asyncHandler(async (req: Request, res: Response) => {
  const { clientId, channel, summary, occurredAt, ownerId } = req.body;
  const conversation = await prisma.clientConversation.create({
    data: {
      clientId,
      channel,
      summary,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      ownerId: ownerId || req.userId,
    },
  });
  res.status(201).json(conversation);
});
