import type { AppRole } from "@prisma/client";

export type EntraClaims = {
  oid: string;
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
};

declare global {
  namespace Express {
    interface Request {
      /** Raw JWT claims after signature validation */
      auth?: EntraClaims;
      /** Application roles resolved from Entra groups on this request (immediate refresh) */
      appRoles?: AppRole[];
      /** Internal user id once resolved from DB */
      userId?: string;
      /** Correlation id for audit + tracing */
      correlationId?: string;
    }
  }
}

export {};
