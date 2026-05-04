import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import jwksClient, { type SigningKey } from "jwks-rsa";
import crypto from "crypto";
import type { AppRole, EntraGroupRoleMap } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { Env } from "../config/env.js";
// Cache for JWKS clients to avoid repeated OIDC discovery calls
const jwksClients = new Map<string, any>();

function getJwksClientForIssuer(issuer: string) {
  // Normalize issuer by removing trailing slash
  const cleanIssuer = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
  
  if (jwksClients.has(cleanIssuer)) {
    return jwksClients.get(cleanIssuer);
  }

  // Extract tenant ID (the UUID-like part) from the issuer URL
  const parts = cleanIssuer.split("/");
  const tenantId = parts.find(p => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p));
  
  if (!tenantId) {
    console.error(`Could not extract tenant ID from issuer: ${issuer}. Falling back to 'common'.`);
  }

  const isV2 = cleanIssuer.includes("/v2.0");
  const targetTenant = tenantId || "common";
  
  // Microsoft v1.0 and v2.0 have different discovery paths
  const jwksUri = isV2 
    ? `https://login.microsoftonline.com/${targetTenant}/discovery/v2.0/keys`
    : `https://login.microsoftonline.com/${targetTenant}/discovery/keys`;

  console.log(`Creating JWKS client for issuer: ${cleanIssuer} -> jwksUri: ${jwksUri}`);

  const client = jwksClient({
    jwksUri,
    cache: true,
    rateLimit: true,
  });

  jwksClients.set(cleanIssuer, client);
  return client;
}

type AzureAdJwtPayload = jwt.JwtPayload & {
  oid?: string; 
  groups?: string[];
  roles?: string[];
  preferred_username?: string;
  appid?: string; // For v1.0 tokens
  azp?: string;   // For v2.0 tokens
};

/**
 * Validates Microsoft Entra ID access tokens (Bearer JWT).
 * No passwords in DB — identity is oid + email from token; roles from group claims + EntraGroupRoleMap.
 */
export function createAuthMiddleware(env: Env) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for public endpoints
    const publicPaths = [
      '/health',
      '/auth/azure/login',
      '/auth/azure/token',
      '/auth/azure/callback',
      '/admin/bootstrap'
    ];

    if (publicPaths.includes(req.path) || publicPaths.some(path => req.originalUrl.startsWith(path))) {
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      console.warn("Auth failed: Missing or malformed Bearer token", { 
        path: req.path, 
        hasHeader: !!header 
      });
      res.status(401).json({ error: "unauthorized", message: "Missing bearer token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();

    try {
      // 1. Decode token WITHOUT verification first to get the issuer (iss) and kid
      const unverified = jwt.decode(token, { complete: true }) as { 
        header: jwt.JwtHeader; 
        payload: AzureAdJwtPayload 
      } | null;

      if (!unverified || !unverified.payload.iss) {
        throw new Error("Invalid token format: missing issuer");
      }

      const issuer = unverified.payload.iss;
      const kid = unverified.header.kid;

      if (!kid) {
        throw new Error("JWT kid missing in header");
      }

      // 2. Resolve the correct JWKS client based on the issuer
      const client = getJwksClientForIssuer(issuer);

      // 3. Get the signing key dynamically
      const signingKey = await new Promise<string>((resolve, reject) => {
        client.getSigningKey(kid, (err: Error | null, key?: SigningKey) => {
          if (err) {
            console.error(`Failed to get signing key for kid ${kid} from issuer ${issuer}:`, err.message);
            reject(err);
          } else {
            const pubKey = key?.getPublicKey();
            if (pubKey) resolve(pubKey);
            else reject(new Error("Unable to resolve signing key from JWKS"));
          }
        });
      });

      // 4. Verify signature using the resolved key
      const decoded = await new Promise<AzureAdJwtPayload>((resolve, reject) => {
        jwt.verify(
          token,
          signingKey,
          {
            algorithms: ["RS256"],
          },
          (err: jwt.VerifyErrors | null, payload: any) => {
            if (err) reject(err);
            else resolve(payload as AzureAdJwtPayload);
          },
        );
      });

      console.log(`JWT verified for auth:`, {
        path: req.path,
        aud: decoded.aud,
        iss: decoded.iss,
        oid: decoded.oid ?? decoded.sub,
      });

      // 5. Validate Issuer
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
        console.warn("JWT issuer mismatch:", { received: issuer, allowed: allowedIssuers });
        res.status(401).json({ error: "unauthorized", message: "Invalid token issuer" });
        return;
      }

      // 6. Validate Audience
      const aud = decoded.aud;
      const allowedAudiences = [
        env.AZURE_AD_AUDIENCE,
        env.AZURE_AD_CLIENT_ID,
        "00000003-0000-0000-c000-000000000000", // Microsoft Graph
      ];

      const isAudienceValid = Array.isArray(aud) 
        ? aud.some(a => allowedAudiences.includes(a))
        : typeof aud === 'string' && allowedAudiences.includes(aud);

      if (!isAudienceValid) {
        console.warn("JWT audience mismatch:", { received: aud, allowed: allowedAudiences });
        res.status(401).json({ error: "unauthorized", message: "Invalid token audience" });
        return;
      }

      // 7. Security Check: verify the Authorized Party (azp) or Client ID
      const authorizedParty = decoded.azp ?? decoded.appid ?? decoded.aud;
      if (authorizedParty !== env.AZURE_AD_CLIENT_ID && !allowedAudiences.includes(authorizedParty as string)) {
        console.error("Token rejected: authorized party does not match our Client ID", {
          expected: env.AZURE_AD_CLIENT_ID,
          received: authorizedParty
        });
        res.status(401).json({ error: "unauthorized", message: "Token issued to unauthorized application" });
        return;
      }

      // Check if token is blacklisted (user logged out)
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const blacklistedToken = await prisma.tokenBlacklist.findUnique({
        where: { tokenHash },
        select: { id: true }
      });

      if (blacklistedToken) {
        res.status(401).json({ error: "unauthorized", message: "Token has been revoked" });
        return;
      }

      const oid = decoded.oid ?? decoded.sub;
      if (!oid) {
        res.status(401).json({ error: "unauthorized", message: "Token missing oid" });
        return;
      }

      const groups = decoded.groups ?? [];
      const maps = await prisma.entraGroupRoleMap.findMany({
        where: { entraGroupId: { in: groups } },
      });

      let roleSet = new Set<AppRole>(maps.map((m: EntraGroupRoleMap) => m.role));

      // Bootstrap Mode: If no role mappings exist in the entire system, 
      // the first person to log in gets SUPER_ADMIN for this session.
      if (roleSet.size === 0) {
        const totalMappings = await prisma.entraGroupRoleMap.count();
        if (totalMappings === 0) {
          roleSet.add("SUPER_ADMIN" as AppRole);
        }
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

      const displayName = typeof decoded.name === "string" ? decoded.name : email?.split("@")[0] ?? "User";
      const userEmail = email ?? `${oid}@users.noaadomain.local`;

      // Define role priority for merging
      const rolePriority: Record<AppRole, number> = {
        SUPER_ADMIN: 100,
        HR_ADMIN: 80,
        MANAGER: 60,
        EMPLOYEE: 40,
        READ_ONLY: 20,
      };

      // Resolve the highest role from Entra groups
      const groupRole = req.appRoles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" 
                      : req.appRoles.includes("HR_ADMIN") ? "HR_ADMIN"
                      : req.appRoles.includes("MANAGER") ? "MANAGER"
                      : req.appRoles.includes("EMPLOYEE") ? "EMPLOYEE"
                      : req.appRoles.length > 0 ? req.appRoles[0]
                      : "EMPLOYEE";

      // Fetch existing user to check for manual role overrides
      const existingUser = await prisma.user.findUnique({
        where: { entraObjectId: oid },
        select: { role: true },
      });

      // Determine final role: Higher priority wins
      let finalRole = groupRole as AppRole;
      if (existingUser?.role) {
        const currentPriority = rolePriority[existingUser.role] || 0;
        const resolvedPriority = rolePriority[finalRole] || 0;
        
        // If current DB role is higher priority, keep it (manual override)
        if (currentPriority > resolvedPriority) {
          finalRole = existingUser.role;
        }
      }

      // Database registration: Always upsert the user record on login.
      const user = await prisma.user.upsert({
        where: { entraObjectId: oid },
        create: {
          entraObjectId: oid,
          email: userEmail,
          displayName,
          lastGroupSyncAt: new Date(),
          isActive: true,
          role: finalRole,
        },
        update: {
          email: userEmail,
          displayName,
          lastGroupSyncAt: new Date(),
          role: finalRole,
        },
        select: { id: true, role: true },
      });

      // Final session roles: Unique set of group roles + persistent DB role
      roleSet.add(user.role);
      req.appRoles = [...roleSet];
      req.userId = user.id;

      next();
    } catch (err) {
      const error = err as Error;
      console.error("JWT verification failed:", {
        message: error.message,
        stack: error.stack,
        token_preview: token.substring(0, 20) + "..."
      });
      res.status(401).json({ error: "unauthorized", message: "Invalid or expired token", detail: error.message });
    }
  };
}
