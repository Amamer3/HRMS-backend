import type { NotificationChannel, NotificationEventType, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { InAppPushAdapter } from "./adapters/inAppPushAdapter.js";
import { MsGraphEmailAdapter } from "./adapters/msGraphEmailAdapter.js";
import type { DispatchContext } from "./types.js";

export type { DispatchContext };

type Adapters = {
  email?: MsGraphEmailAdapter;
  inApp: InAppPushAdapter;
};

/**
 * Unified facade — workflow actions call `dispatchForEvent` with event type + resolved channels.
 * Per-channel adapters isolate provider SDKs (e.g. MS Graph for email).
 */
export class NotificationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly adapters: Adapters,
  ) {}

  static createDefault(): NotificationService {
    return new NotificationService(prisma, {
      inApp: new InAppPushAdapter(prisma),
      email: new MsGraphEmailAdapter(),
    });
  }

  async dispatchForEvent(ctx: DispatchContext, channels: NotificationChannel[]) {
    for (const channel of channels) {
      const row = await this.db.notificationDelivery.create({
        data: {
          eventType: ctx.eventType,
          channel,
          recipientId: ctx.recipientUserId,
          payload: ctx.payload as object,
          status: "QUEUED",
        },
      });

      try {
        switch (channel) {
          case "EMAIL_MS_GRAPH":
            await this.adapters.email?.send(ctx);
            break;
          case "IN_APP":
            await this.adapters.inApp.send(ctx);
            break;
          default:
            break;
        }
        await this.db.notificationDelivery.update({
          where: { id: row.id },
          data: { status: "SENT", sentAt: new Date() },
        });
      } catch (err) {
        await this.db.notificationDelivery.update({
          where: { id: row.id },
          data: { status: "FAILED", error: String(err).slice(0, 1024) },
        });
      }
    }
  }

  async channelsForRole(role: import("@prisma/client").AppRole, eventType: NotificationEventType) {
    const pref = await this.db.roleNotificationPreference.findUnique({
      where: { role_eventType: { role, eventType } },
    });
    return pref?.channels ?? (["IN_APP"] as NotificationChannel[]);
  }
}
