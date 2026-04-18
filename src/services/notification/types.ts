import type { NotificationEventType } from "@prisma/client"; 

export type DispatchContext = {
  eventType: NotificationEventType;
  recipientUserId?: string;
  toEmail?: string;
  payload: Record<string, unknown>;
};
