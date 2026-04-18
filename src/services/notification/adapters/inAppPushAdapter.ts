import type { PrismaClient } from "@prisma/client";
import type { DispatchContext } from "../types.js";

export class InAppPushAdapter {
  constructor(private readonly db: PrismaClient) {}

  async send(ctx: DispatchContext): Promise<void> {
    if (!ctx.recipientUserId) return;
    const title = String(ctx.payload.title ?? "Notification");
    const body = String(ctx.payload.body ?? "");
    await this.db.inAppNotification.create({
      data: {
        userId: ctx.recipientUserId,
        title,
        body,
      },
    });
  }
}
