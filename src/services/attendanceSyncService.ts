import type { Prisma, PrismaClient } from "@prisma/client";
import { evaluateGeofence } from "./geofenceService.js";

/** 
 * Offline / sync model:
 * - Each clock event carries optional `idempotencyKey` (client-generated UUID) to dedupe retries.
 * - If the same session already has a CLOSED conflicting OUT from another device/time window, flag SYNC_CONFLICT.
 */

export type OfflineClockPayload = {
  userId: string;
  branchId: string;
  type: "CLOCK_IN" | "CLOCK_OUT";
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  clientTimestamp: Date;
  idempotencyKey?: string | null;
  source: "ONLINE" | "OFFLINE_SYNC";
};

export class AttendanceSyncService {
  constructor(private readonly db: PrismaClient) {}

  async resolveActiveSession(userId: string, workDate: Date) {
    return this.db.attendanceSession.findUnique({
      where: { userId_workDate: { userId, workDate } },
      include: { events: { orderBy: { serverTimestamp: "asc" } } },
    });
  }

  /**
   * Applies a clock event with geofence validation and idempotency.
   * Location rows are queryable only via controllers guarded by HR_ATTENDANCE_READ_SENSITIVE.
   */
  async applyClockEvent(
    payload: OfflineClockPayload,
    branch: { latitude: Prisma.Decimal; longitude: Prisma.Decimal; geofenceRadiusM: number },
  ) {
    if (payload.idempotencyKey) {
      const existing = await this.db.clockEvent.findUnique({
        where: { idempotencyKey: payload.idempotencyKey },
      });
      if (existing) {
        return { status: "duplicate_ignored" as const, event: existing };
      }
    }

    const branchLat = Number(branch.latitude);
    const branchLon = Number(branch.longitude);

    const geo = evaluateGeofence({
      employeeLat: payload.latitude,
      employeeLon: payload.longitude,
      branchLat,
      branchLon,
      allowedRadiusM: branch.geofenceRadiusM,
      accuracyM: payload.accuracyM,
    });

    const workDate = new Date(Date.UTC(
      payload.clientTimestamp.getUTCFullYear(),
      payload.clientTimestamp.getUTCMonth(),
      payload.clientTimestamp.getUTCDate(),
    ));

    const session =
      (await this.resolveActiveSession(payload.userId, workDate)) ??
      (await this.db.attendanceSession.create({
        data: {
          userId: payload.userId,
          branchId: payload.branchId,
          workDate,
          status: "OPEN",
        },
      }));

    // Conflict heuristic: multiple CLOCK_IN without CLOCK_OUT from different batches
    const openInWithoutOut = await this.detectSessionConflict(session.id, payload.type);
    if (openInWithoutOut && payload.type === "CLOCK_IN") {
      await this.db.attendanceSession.update({
        where: { id: session.id },
        data: { status: "SYNC_CONFLICT", conflictNote: "Duplicate open clock-in detected on sync" },
      });
    }

    const event = await this.db.clockEvent.create({
      data: {
        sessionId: session.id,
        userId: payload.userId,
        branchId: payload.branchId,
        type: payload.type,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracyM: payload.accuracyM ?? undefined,
        haversineDistanceM: geo.distanceM,
        accepted: geo.accepted,
        rejectionReason: geo.accepted
          ? undefined
          : geo.accuracyRejected
            ? "accuracy_or_unknown_location"
            : "outside_geofence",
        source: payload.source,
        clientTimestamp: payload.clientTimestamp,
        idempotencyKey: payload.idempotencyKey ?? undefined,
      },
    });

    return { status: "created" as const, event, geofence: geo };
  }

  private async detectSessionConflict(sessionId: string, incomingType: "CLOCK_IN" | "CLOCK_OUT") {
    if (incomingType !== "CLOCK_IN") return false;
    const events = await this.db.clockEvent.findMany({
      where: { sessionId },
      orderBy: { serverTimestamp: "asc" },
    });
    let depth = 0;
    for (const e of events) {
      if (e.type === "CLOCK_IN") depth += 1;
      else depth -= 1;
    }
    return depth > 0;
  }
}
