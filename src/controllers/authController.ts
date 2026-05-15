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
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: expiresIn * 1000,
    path: "/",
  });
}

function clearSessionCookie(res: ExpressResponse): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? "none" : "lax", path: "/" });
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

function apiDefaultScope(audience: string): string {
  return audience.endsWith("/.default") ? audience : `${audience}/.default`;
}

/** OAuth scopes for authorize + token exchange. Always includes the API `.default` scope. */
function buildAzureAuthScope(env: Env): string {
  const apiScope = apiDefaultScope(env.AZURE_AD_AUDIENCE);
  const provided = env.AZURE_AD_AUTH_SCOPE.split(/\s+/).filter(Boolean);
  return Array.from(new Set(["openid", "profile", "email", "offline_access", ...provided, apiScope])).join(
    " ",
  );
}

function resolveDefaultRedirect(env: Env): string {
  if (env.FRONTEND_URL) {
    return `${env.FRONTEND_URL.replace(/\/$/, "")}/auth/callback`;
  }
  return env.NODE_ENV === "production"
    ? "https://hrms.echt.gh/auth/callback"
    : "http://localhost:3000/auth/callback";
}

function tokenPayload(tokens: AzureTokenResponse) {
  return {
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
  };
}

async function exchangeAuthorizationCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<AzureTokenResponse> {
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
        scope: buildAzureAuthScope(env),
      }).toString(),
    },
  );

  const body = (await tokenResponse.json()) as AzureTokenResponse;

  if (!tokenResponse.ok) {
    logger.error({ error: body.error, description: body.error_description }, "Azure token exchange failed");
    throw Object.assign(new Error(body.error_description ?? body.error ?? "token_exchange_failed"), {
      status: tokenResponse.status,
      azure: body,
    });
  }

  if (!body.access_token) {
    logger.error({ scope: body.scope }, "Azure token response missing access_token");
    throw Object.assign(
      new Error(
        "Microsoft sign-in succeeded but no API access token was returned. " +
          "Ensure the app registration exposes an API scope and AZURE_AD_AUTH_SCOPE includes it.",
      ),
      { status: 502, code: "no_access_token" },
    );
  }

  return body;
}

export function buildAuthRouter(env: Env): Router {
  const r = Router();

  const defaultRedirect = resolveDefaultRedirect(env);

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
        scope: buildAzureAuthScope(env),
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

      try {
        const tokens = await exchangeAuthorizationCode(env, code, redirectUri);
        setSessionCookie(res, tokens.access_token, tokens.expires_in);
        res.json(tokenPayload(tokens));
      } catch (err: unknown) {
        const e = err as Error & { status?: number; azure?: AzureTokenResponse; code?: string };
        if (e.azure) {
          res.status(e.status ?? 400).json({
            error: e.azure.error ?? "token_exchange_failed",
            description: e.azure.error_description,
          });
          return;
        }
        res.status(e.status ?? 502).json({
          error: e.code ?? "token_exchange_failed",
          message: e.message,
        });
      }
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

      let tokens: AzureTokenResponse;
      try {
        tokens = await exchangeAuthorizationCode(env, code as string, redirectUri);
      } catch (err: unknown) {
        const e = err as Error & { status?: number; azure?: AzureTokenResponse; code?: string };
        if (e.azure) {
          res.status(e.status ?? 400).json({
            error: e.azure.error ?? "token_exchange_failed",
            description: e.azure.error_description,
          });
          return;
        }
        res.status(e.status ?? 502).json({
          error: e.code ?? "token_exchange_failed",
          message: e.message,
        });
        return;
      }

      setSessionCookie(res, tokens.access_token, tokens.expires_in);

      const acceptHeader = req.headers.accept ?? "";

      if (acceptHeader.includes("application/json")) {
        res.json({ ...tokenPayload(tokens), state });
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
