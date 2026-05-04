import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

const clients = new Map<string, any>();
const conversations = new Map<string, any>();

export async function getClients(_req: Request, res: Response) {
  res.json(Array.from(clients.values()));
}

export async function createClient(req: Request, res: Response) {
  const id = randomUUID();
  const client = { id, ...req.body, status: "ACTIVE", createdAt: new Date() };
  clients.set(id, client);
  res.status(201).json(client);
}

export async function updateClient(req: Request, res: Response) {
  const id = req.params.id as string;
  const client = clients.get(id);
  if (!client) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  Object.assign(client, req.body);
  res.json(client);
}

export async function deleteClient(req: Request, res: Response) {
  const id = req.params.id as string;
  clients.delete(id);
  res.status(204).send();
}

export async function getConversations(req: Request, res: Response) {
  const { client_id } = req.query;
  let all = Array.from(conversations.values());
  if (client_id) all = all.filter(c => c.clientId === (Array.isArray(client_id) ? client_id[0] : client_id));
  res.json(all);
}

export async function createConversation(req: Request, res: Response) {
  const id = randomUUID();
  const conversation = { id, ...req.body, status: "OPEN", createdAt: new Date() };
  conversations.set(id, conversation);
  res.status(201).json(conversation);
}
