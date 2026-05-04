import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "../lib/asyncHandler.js";
import { NotFoundError } from "../lib/errors.js";

const clients = new Map<string, any>();
const conversations = new Map<string, any>();

export const getClients = asyncHandler(async (_req: Request, res: Response) => {
  res.json(Array.from(clients.values()));
});

export const createClient = asyncHandler(async (req: Request, res: Response) => {
  const id = randomUUID();
  const client = { id, ...req.body, status: "ACTIVE", createdAt: new Date() };
  clients.set(id, client);
  res.status(201).json(client);
});

export const updateClient = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const client = clients.get(id);
  if (!client) {
    throw new NotFoundError("Client not found");
  }
  Object.assign(client, req.body);
  res.json(client);
});

export const deleteClient = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!clients.has(id)) {
    throw new NotFoundError("Client not found");
  }
  clients.delete(id);
  res.status(204).send();
});

export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  const { client_id } = req.query;
  let all = Array.from(conversations.values());
  if (client_id) all = all.filter(c => c.clientId === (Array.isArray(client_id) ? client_id[0] : client_id));
  res.json(all);
});

export const createConversation = asyncHandler(async (req: Request, res: Response) => {
  const id = randomUUID();
  const conversation = { id, ...req.body, status: "OPEN", createdAt: new Date() };
  conversations.set(id, conversation);
  res.status(201).json(conversation);
});
