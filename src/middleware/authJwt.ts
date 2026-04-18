import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import jwksClient, { type SigningKey } from "jwks-rsa";
import type { AppRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { Env } from "../config/env.js";
type AzureAdJwtPayload = jwt.JwtPayload & {
  oid?: string; 
  groups?: string[];
  roles?: string[];
  preferred_username?: string;
};

function getKeyResolver(env: Env) {
  const client = jwksClient({
    jwksUri: `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/discovery/v2.0/keys`,
    cache: true,
    rateLimit: true,
  });

  return (header: jwt.JwtHeader, cb: (err: Error | null, key?: string) => void) => {
    if (!header.kid) {
      cb(new Error("JWT kid missing"));
      return;
    }
    client.getSigningKey(header.kid, (err: Error | null, key?: SigningKey) => {
      if (err) {
        cb(err);
        return;
      }
      const signingKey = key?.getPublicKey();
      if (!signingKey) {
        cb(new Error("Unable to resolve signing key"));
        return;
      }
      cb(null, signingKey);
    });
  };
}

/**
 * Validates Microsoft Entra ID access tokens (Bearer JWT).
 * No passwords in DB — identity is oid + email from token; roles from group claims + EntraGroupRoleMap.
 */
export function createAuthMiddleware(env: Env) {
  const getKey = getKeyResolver(env);

  return async function authJwt(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized", message: "Missing bearer token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();

    try {
      const decoded = await new Promise<AzureAdJwtPayload>((resolve, reject) => {
        jwt.verify(
          token,
          getKey,
          {
            audience: env.AZURE_AD_AUDIENCE,
            issuer: env.AZURE_AD_ISSUER,
            algorithms: ["RS256"],
          },
          (err, payload) => {
            if (err) reject(err);
            else resolve(payload as AzureAdJwtPayload);
          },
        );
      });

      const oid = decoded.oid ?? decoded.sub;
      if (!oid) {
        res.status(401).json({ error: "unauthorized", message: "Token missing oid" });
        return;
      }

      const groups = decoded.groups ?? [];
      const maps = await prisma.entraGroupRoleMap.findMany({
        where: { entraGroupId: { in: groups } },
      });

      const roleSet = new Set<AppRole>(maps.map((m) => m.role));

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

      const displayName = typeof decoded.name === "string" ? decoded.name : email?.split("@")[0] ?? "User";
      const userEmail = email ?? `${oid}@users.noaadomain.local`;

      const user = await prisma.user.upsert({
        where: { entraObjectId: oid },
        create: {
          entraObjectId: oid,
          email: userEmail,
          displayName,
        },
        update: {
          email: userEmail,
          displayName,
          lastGroupSyncAt: new Date(),
        },
        select: { id: true },
      });
      req.userId = user.id;

      next();
    } catch {
      res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    }
  };
}
