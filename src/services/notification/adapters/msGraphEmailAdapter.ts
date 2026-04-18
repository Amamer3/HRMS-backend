import type { DispatchContext } from "../types.js";

/**
 * MS Graph sendMail — implement with client credentials + recipient resolution in production.
 * Kept as no-op with structured log hook to avoid network dependency in scaffold.
 */
export class MsGraphEmailAdapter {
  async send(ctx: DispatchContext): Promise<void> {
    if (!ctx.toEmail) return;
    // await graphClient.api('/users/{id}/sendMail').post(...)
    void ctx;
  }
}
