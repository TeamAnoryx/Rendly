import path from "path";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import { getUserById, getUserByProviderId } from "./supabase-users";
import { resolveJwtSecret } from "./security";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

// Fails closed in production: a known fallback secret would let anyone forge a token.
const JWT_SECRET = resolveJwtSecret();

export type CurrentUser = { userId: string; username: string | null };

/**
 * Recently resolved users, keyed by token subject. Every socket handshake and REST call used to
 * read the users table; under load that was one query per request. Entries live USER_CACHE_TTL_MS,
 * so a deleted user or renamed username is seen within that window. Misses are not cached.
 */
const USER_CACHE_TTL_MS = 60_000;
const USER_CACHE_MAX = 20_000;
const userCache = new Map<string, { user: CurrentUser; expires: number }>();

function cachedUser(key: string): CurrentUser | null {
  const hit = userCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    userCache.delete(key);
    return null;
  }
  return hit.user;
}

function rememberUser(key: string, user: CurrentUser): void {
  if (userCache.size >= USER_CACHE_MAX) {
    const oldest = userCache.keys().next().value;
    if (oldest !== undefined) userCache.delete(oldest);
  }
  userCache.set(key, { user, expires: Date.now() + USER_CACHE_TTL_MS });
}

const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_MAX = 20_000;
const tokenCache = new Map<string, { user: CurrentUser; expires: number }>();

function cachedToken(token: string): CurrentUser | null {
  const hit = tokenCache.get(token);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    tokenCache.delete(token);
    return null;
  }
  return hit.user;
}

function rememberToken(token: string, user: CurrentUser, expSec: number | undefined): void {
  const until = Math.min(Date.now() + TOKEN_CACHE_TTL_MS, expSec ? expSec * 1000 : Infinity);
  if (until <= Date.now()) return;
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(token, { user, expires: until });
}

/** Decode JWT and return current user id (from users table). Same secret as auth-service. */
export async function getCurrentUserFromRequest(req: express.Request): Promise<CurrentUser | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const known = cachedToken(token);
  if (known) return known;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as { sub?: string; provider?: string; exp?: number };
    const sub = decoded?.sub;
    if (!sub) return null;
    const cacheKey = `${decoded?.provider ?? "github"}:${sub}`;
    const cached = cachedUser(cacheKey);
    if (cached) {
      rememberToken(token, cached, decoded.exp);
      return cached;
    }
    let user: { id?: string; username?: string | null } | null;
    if (decoded?.provider === "password") {
      user = await getUserById(sub);
    } else {
      const provider = decoded?.provider === "linkedin" ? "linkedin" : "github";
      user = await getUserByProviderId(provider, sub);
    }
    if (!user) return null;
    const current: CurrentUser = {
      userId: (user as { id?: string }).id ?? "",
      username: user.username ?? null,
    };
    if (current.userId) {
      rememberUser(cacheKey, current);
      rememberToken(token, current, decoded.exp);
    }
    return current;
  } catch {
    return null;
  }
}

/** Middleware: require auth, 401 if not. */
export function requireAuth(
  req: express.Request & { currentUser?: CurrentUser },
  res: express.Response,
  next: express.NextFunction
): void {
  getCurrentUserFromRequest(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ message: "Missing or invalid authorization" });
        return;
      }
      (req as express.Request & { currentUser: CurrentUser }).currentUser = user;
      next();
    })
    .catch((err) => next(err));
}
