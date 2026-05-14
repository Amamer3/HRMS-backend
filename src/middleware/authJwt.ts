import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import jwksClient, { type SigningKey } from "jwks-rsa";
import crypto from "crypto";
import pino from "pino";
import type { AppRole, EntraGroupRoleMap } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { Env } from "../config/env.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// Cache for JWKS clients — bounded to avoid unbounded growth
const jwksClients = new Map<string, ReturnType<typeof jwksClient>>();

// Role priority is a static constant; define once at module scope
const ROLE_PRIORITY: Record<AppRole, number> = {
  SUPER_ADMIN: 100,
  HR_ADMIN: 80,
  MANAGER: 60,
  EMPLOYEE: 40,
  READ_ONLY: 20,
};

function getJwksClientForIssuer(issuer: string) {
  const cleanIssuer = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;

  if (jwksClients.has(cleanIssuer)) {
    return jwksClients.get(cleanIssuer)!;
  }

  const parts = cleanIssuer.split("/");
  const tenantId = parts.find(p =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p),
  );

  if (!tenantId) {
    logger.warn({ issuer }, "Could not extract tenant ID from issuer, falling back to 'common'");
  }

  const isV2 = cleanIssuer.includes("/v2.0");
  const targetTenant = tenantId ?? "common";
  const jwksUri = isV2
    ? `https://login.microsoftonline.com/${targetTenant}/discovery/v2.0/keys`
    : `https://login.microsoftonline.com/${targetTenant}/discovery/keys`;

  const client = jwksClient({ jwksUri, cache: true, rateLimit: true });

  // Evict oldest entry if cache grows beyond 20 issuers
  if (jwksClients.size >= 20) {
    const firstKey = jwksClients.keys().next().value;
    if (firstKey) jwksClients.delete(firstKey);
  }

  jwksClients.set(cleanIssuer, client);
  return client;
}

type AzureAdJwtPayload = jwt.JwtPayload & {
  oid?: string;
  groups?: string[];
  roles?: string[];
  preferred_username?: string;
  appid?: string;
  azp?: string;
};

export function createAuthMiddleware(env: Env) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const publicPaths = [
      "/health",
      "/auth/azure/login",
      "/auth/azure/token",
      "/auth/azure/callback",
      "/admin/bootstrap",
    ];

    if (
      publicPaths.includes(req.path) ||
      publicPaths.some(p => req.originalUrl.startsWith(p))
    ) {
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      logger.warn({ path: req.path, hasHeader: !!header }, "Auth failed: missing or malformed Bearer token");
      res.status(401).json({ error: "unauthorized", message: "Missing bearer token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();

    try {
      const unverified = jwt.decode(token, { complete: true }) as {
        header: jwt.JwtHeader;
        payload: AzureAdJwtPayload;
      } | null;

      if (!unverified?.payload.iss) {
        throw new Error("Invalid token format: missing issuer");
      }

      const issuer = unverified.payload.iss;
      const kid = unverified.header.kid;
      if (!kid) throw new Error("JWT kid missing in header");

      const client = getJwksClientForIssuer(issuer);

      const signingKey = await new Promise<string>((resolve, reject) => {
        client.getSigningKey(kid, (err: Error | null, key?: SigningKey) => {
          if (err) {
            reject(err);
          } else {
            const pubKey = key?.getPublicKey();
            pubKey ? resolve(pubKey) : reject(new Error("Unable to resolve signing key from JWKS"));
          }
        });
      });

      const decoded = await new Promise<AzureAdJwtPayload>((resolve, reject) => {
        jwt.verify(token, signingKey, { algorithms: ["RS256"] }, (err, payload) => {
          err ? reject(err) : resolve(payload as AzureAdJwtPayload);
        });
      });

      // Validate issuer
      const tenantId = env.AZURE_AD_TENANT_ID;
      const allowedIssuers = [
        env.AZURE_AD_ISSUER,
        `${env.AZURE_AD_ISSUER}/`,
        `${env.AZURE_AD_ISSUER}/v2.0`,
        `${env.AZURE_AD_ISSUER}/v2.0/`,
        `https://sts.windows.net/${tenantId}/`,
        `https://login.microsoftonline.com/${tenantId}/v2.0`,
        `https://login.microsoftonline.com/${tenantId}/v2.0/`,
      ];

      if (!allowedIssuers.includes(issuer)) {
        logger.warn({ received: issuer }, "JWT issuer mismatch");
        res.status(401).json({ error: "unauthorized", message: "Invalid token issuer" });
        return;
      }

      // Validate audience — only accept tokens issued for this API
      const aud = decoded.aud;
      const allowedAudiences = [env.AZURE_AD_AUDIENCE, env.AZURE_AD_CLIENT_ID];

      const isAudienceValid = Array.isArray(aud)
        ? aud.some(a => allowedAudiences.includes(a))
        : typeof aud === "string" && allowedAudiences.includes(aud);

      if (!isAudienceValid) {
        logger.warn({ received: aud }, "JWT audience mismatch");
        res.status(401).json({ error: "unauthorized", message: "Invalid token audience" });
        return;
      }

      // Validate authorized party
      const authorizedParty = decoded.azp ?? decoded.appid ?? decoded.aud;
      if (
        authorizedParty !== env.AZURE_AD_CLIENT_ID &&
        !allowedAudiences.includes(authorizedParty as string)
      ) {
        logger.error({ received: authorizedParty }, "Token rejected: authorized party mismatch");
        res.status(401).json({ error: "unauthorized", message: "Token issued to unauthorized application" });
        return;
      }

      // Check token blacklist
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const blacklisted = await prisma.tokenBlacklist.findUnique({
        where: { tokenHash },
        select: { id: true },
      });
      if (blacklisted) {
        res.status(401).json({ error: "unauthorized", message: "Token has been revoked" });
        return;
      }

      const oid = decoded.oid ?? decoded.sub;
      if (!oid) {
        res.status(401).json({ error: "unauthorized", message: "Token missing subject" });
        return;
      }

      const groups = decoded.groups ?? [];
      const maps = await prisma.entraGroupRoleMap.findMany({
        where: { entraGroupId: { in: groups } },
      });

      let roleSet = new Set<AppRole>(maps.map((m: EntraGroupRoleMap) => m.role));

      // Bootstrap: first login when no mappings exist gets SUPER_ADMIN for this session only
      if (roleSet.size === 0) {
        const totalMappings = await prisma.entraGroupRoleMap.count();
        if (totalMappings === 0) roleSet.add("SUPER_ADMIN" as AppRole);
      }

      const email =
        typeof decoded.email === "string"
          ? decoded.email
          : typeof decoded.preferred_username === "string"
            ? decoded.preferred_username
            : undefined;

      req.auth = {
        oid,
        sub: typeof decoded.sub === "string" ? decoded.sub : oid,
        email,
        name: typeof decoded.name === "string" ? decoded.name : undefined,
        groups,
      };
      req.appRoles = [...roleSet];

      const displayName =
        typeof decoded.name === "string" ? decoded.name : email?.split("@")[0] ?? "User";
      const userEmail = email ?? `${oid}@users.noaadomain.local`;

      // Determine highest-priority role from Entra groups
      const groupRole = req.appRoles.includes("SUPER_ADMIN")
        ? "SUPER_ADMIN"
        : req.appRoles.includes("HR_ADMIN")
          ? "HR_ADMIN"
          : req.appRoles.includes("MANAGER")
            ? "MANAGER"
            : req.appRoles.includes("EMPLOYEE")
              ? "EMPLOYEE"
              : req.appRoles.length > 0
                ? req.appRoles[0]
                : "EMPLOYEE";

      // Fetch existing user — only write to DB when something actually changed
      const existingUser = await prisma.user.findUnique({
        where: { entraObjectId: oid },
        select: { id: true, role: true, email: true, displayName: true },
      });

      let finalRole = groupRole as AppRole;
      if (existingUser?.role) {
        const currentPriority = ROLE_PRIORITY[existingUser.role] ?? 0;
        const resolvedPriority = ROLE_PRIORITY[finalRole] ?? 0;
        if (currentPriority > resolvedPriority) finalRole = existingUser.role;
      }

      let user: { id: string; role: AppRole };

      if (!existingUser) {
        // First login — create user record
        user = await prisma.user.create({
          data: {
            entraObjectId: oid,
            email: userEmail,
            displayName,
            lastGroupSyncAt: new Date(),
            isActive: true,
            role: finalRole,
          },
          select: { id: true, role: true },
        });
      } else if (
        existingUser.role !== finalRole ||
        existingUser.email !== userEmail ||
        existingUser.displayName !== displayName
      ) {
        // Only write when something actually changed
        user = await prisma.user.update({
          where: { entraObjectId: oid },
          data: { email: userEmail, displayName, lastGroupSyncAt: new Date(), role: finalRole },
          select: { id: true, role: true },
        });
      } else {
        user = { id: existingUser.id, role: existingUser.role };
      }

      roleSet.add(user.role);
      req.appRoles = [...roleSet];
      req.userId = user.id;

      next();
    } catch (err) {
      const error = err as Error;
      logger.error({ message: error.message, path: req.path }, "JWT verification failed");
      // Never expose internal error details to the client
      res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    }
  };
}
