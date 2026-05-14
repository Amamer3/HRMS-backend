import { Router } from "express";
import type { Response as ExpressResponse } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import pino from "pino";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../lib/errors.js";
import { storeOAuthState, consumeOAuthState } from "../lib/oauthState.js";
import type { Env } from "../config/env.js";

const SESSION_COOKIE = "hr_session";
const IS_PROD = process.env.NODE_ENV === "production";

function setSessionCookie(res: ExpressResponse, token: string, expiresIn: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: expiresIn * 1000,
    path: "/",
  });
}

function clearSessionCookie(res: ExpressResponse): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: IS_PROD, sameSite: "lax", path: "/" });
}

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

interface AzureTokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
  error?: string;
  error_description?: string;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err: unknown) {
      lastError = err;
      const e = err as NodeJS.ErrnoException;
      if (e.code === "EAI_AGAIN" || e.message?.includes("getaddrinfo")) {
        logger.warn(`DNS lookup failed (attempt ${i + 1}/${retries}). Retrying...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function buildAzureAuthScope(envScope: string | undefined): string {
  const provided = envScope?.split(/\s+/).filter(Boolean) ?? [];
  return Array.from(new Set(provided)).join(" ");
}

export function buildAuthRouter(env: Env): Router {
  const r = Router();

  const defaultRedirect =
    env.NODE_ENV === "production"
      ? "https://hrms.echt.gh/auth/callback"
      : "http://localhost:3000/auth/callback";

  // GET /auth/azure/login
  r.get("/login", (req, res) => {
    const redirectUri = (req.query.redirect_uri as string) || defaultRedirect;
    const state =
      (req.query.state as string) || crypto.randomBytes(16).toString("hex");

    storeOAuthState(state);

    const authUrl =
      `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: env.AZURE_AD_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: buildAzureAuthScope(env.AZURE_AD_AUTH_SCOPE),
        response_mode: "query",
        state,
      }).toString();

    return res.redirect(authUrl);
  });

  // POST /auth/azure/token  — code exchange from a SPA/mobile client
  r.post(
    "/token",
    asyncHandler(async (req, res) => {
      const code = req.body?.code as string | undefined;
      const redirectUri = (req.body?.redirect_uri as string) || defaultRedirect;

      if (!code) throw new BadRequestError("No authorization code provided");

      const tokenResponse = await fetchWithRetry(
        `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.AZURE_AD_CLIENT_ID,
            client_secret: env.AZURE_AD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            scope: buildAzureAuthScope(env.AZURE_AD_AUTH_SCOPE),
          }).toString(),
        },
      );

      if (!tokenResponse.ok) {
        const errorData = (await tokenResponse.json()) as AzureTokenResponse;
        logger.error({ error: errorData.error }, "Azure token exchange failed");
        res.status(tokenResponse.status).json({
          error: errorData.error ?? "token_exchange_failed",
          description: errorData.error_description,
        });
        return;
      }

      const tokens = (await tokenResponse.json()) as AzureTokenResponse;
      setSessionCookie(res, tokens.access_token, tokens.expires_in);
      res.json(tokens);
    }),
  );

  // GET /auth/azure/callback — server-side OAuth callback
  r.get(
    "/callback",
    asyncHandler(async (req, res) => {
      const { code, state } = req.query;
      const redirectUri = (req.query.redirect_uri as string) || defaultRedirect;

      if (!code) throw new BadRequestError("No authorization code provided");

      // Validate CSRF state
      if (!state || !consumeOAuthState(state as string)) {
        res.status(400).json({ error: "invalid_state", message: "Invalid or expired OAuth state" });
        return;
      }

      const tokenResponse = await fetchWithRetry(
        `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.AZURE_AD_CLIENT_ID,
            client_secret: env.AZURE_AD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code: code as string,
            redirect_uri: redirectUri,
            scope: buildAzureAuthScope(env.AZURE_AD_AUTH_SCOPE),
          }).toString(),
        },
      );

      if (!tokenResponse.ok) {
        const errorData = (await tokenResponse.json()) as AzureTokenResponse;
        logger.error({ error: errorData.error }, "Token exchange error in callback");
        res.status(tokenResponse.status).json({
          error: errorData.error ?? "token_exchange_failed",
          description: errorData.error_description,
        });
        return;
      }

      const tokens = (await tokenResponse.json()) as AzureTokenResponse;
      setSessionCookie(res, tokens.access_token, tokens.expires_in);

      const acceptHeader = req.headers.accept ?? "";

      if (acceptHeader.includes("application/json")) {
        res.json({
          access_token: tokens.access_token,
          id_token: tokens.id_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type,
          expires_in: tokens.expires_in,
          scope: tokens.scope,
          state,
        });
        return;
      }

      // Hash-fragment redirect — tokens never appear in server logs or referrer headers
      const frontendUrl = new URL(redirectUri);
      const hashParams = new URLSearchParams();
      hashParams.set("access_token", tokens.access_token);
      if (tokens.id_token) hashParams.set("id_token", tokens.id_token);
      if (state) hashParams.set("state", state as string);
      frontendUrl.hash = hashParams.toString();

      res.redirect(frontendUrl.toString());
    }),
  );

  return r;
}

/**
 * POST /auth/refresh — no auth middleware required.
 * Reads the httpOnly session cookie and returns the access token if it is not expired.
 * The frontend uses this to restore the in-memory token after a page refresh.
 */
export const refreshSession = asyncHandler(async (req, res) => {
  const cookieToken: string | undefined = (req.cookies as Record<string, string | undefined>)[SESSION_COOKIE];

  if (!cookieToken) {
    res.status(401).json({ error: "no_session", message: "No active session" });
    return;
  }

  // Decode without signature verification — the signature is validated by authJwt on every real API call.
  // Here we only need to check expiry so we don't return obviously stale tokens.
  const decoded = jwt.decode(cookieToken) as jwt.JwtPayload | null;
  const now = Math.floor(Date.now() / 1000);
  if (!decoded?.exp || decoded.exp < now) {
    clearSessionCookie(res);
    res.status(401).json({ error: "session_expired", message: "Session has expired, please sign in again" });
    return;
  }

  // Refresh the cookie TTL so it stays alive as long as the user is active
  const remainingSeconds = decoded.exp - now;
  setSessionCookie(res, cookieToken, remainingSeconds);

  res.json({ access_token: cookieToken, token_type: "Bearer", expires_in: remainingSeconds });
});

/** Standalone logout handler — wired at POST /api/v1/auth/logout in the v1 router. */
export const logout = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new BadRequestError("No token provided");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!req.userId) throw new UnauthorizedError("User not authenticated");

  const decoded = jwt.decode(token) as jwt.JwtPayload;
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 3_600_000);

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  await prisma.tokenBlacklist.create({
    data: { tokenHash, userId: req.userId, expiresAt },
  });

  clearSessionCookie(res);
  res.json({ message: "Logged out successfully" });
});
