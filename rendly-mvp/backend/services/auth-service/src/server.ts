import path from "path";
import crypto from "crypto";
import http from "http";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import axios from "axios";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import multer from "multer";
import sharp from "sharp";
import { upsertUserByGitHub, upsertUserByLinkedIn, getUserByProviderId, getUserById, getUserByEmailOrUsername, getUserByEmail, updateUserById, checkUsernameAvailable, getUsersWithActiveResetToken, getUserByUsername, getUsersByUsernameSearch, supabase } from "./supabase-users";
import { sendPasswordResetEmail } from "./send-reset-email";
import {
  listInvitesForUser,
  createInvite,
  getInviteById,
  updateInviteStatus,
  hasPendingInvite,
  createConnection,
  listConnectionsForUser,
  areConnected,
  deleteConnection,
  createBlock,
  deleteBlock,
  listBlockedIds,
  isBlocked,
} from "./connections";
import {
  listHuddles,
  listActiveHuddles,
  createHuddle,
  getHuddleById,
  getHuddleParticipantCount,
  getParticipantCounts,
  isActiveParticipant,
  joinHuddle,
  type HuddleRow,
} from "./huddles";
import {
  buildInviteUrl,
  canAccessHuddle,
  parseCategory,
  requestOrigin,
  toPublicHuddle,
  validateCreateHuddleInput,
} from "./huddle-rules";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

// Keep process alive on unhandled rejections; log and continue so refresh/retry works
process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("[auth-service] Unhandled rejection at", promise, "reason:", reason);
});
process.on("uncaughtException", (err: Error) => {
  console.error("[auth-service] Uncaught exception:", err);
});

const app = express();
const PORT = Number(process.env.AUTH_SERVICE_PORT || process.env.PORT || 4001);

function normalizeRedirectUri(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const REDIRECT_URI = normalizeRedirectUri(process.env.OAUTH_REDIRECT_URI || "http://localhost:3001/auth/callback");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

/** Idempotency: avoid exchanging the same GitHub code twice (e.g. double useEffect in dev). */
const githubCodeCache = new Map<string, { user: object; jwt: string }>();
const githubCodePending = new Map<string, Promise<{ user: object; jwt: string }>>();
const GITHUB_CODE_CACHE_TTL_MS = 60_000;
function getCachedGitHubResult(code: string): { user: object; jwt: string } | null {
  return githubCodeCache.get(code) ?? null;
}
function setCachedGitHubResult(code: string, user: object, jwt: string) {
  githubCodeCache.set(code, { user, jwt });
  setTimeout(() => githubCodeCache.delete(code), GITHUB_CODE_CACHE_TTL_MS);
}
/** Wait briefly so GitHub can propagate the new token (reduces 401 Bad credentials). */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Decode JWT and return current user from DB, or null. */
type UserFromToken = { id: string; email: string | null; avatar_url: string | null; github_id: string | null; github_url: string | null; linkedin_id: string | null; linkedin_url: string | null; username?: string | null; selected_intents?: string[] | null; bio?: string | null; profession?: string | null };
async function getCurrentUserFromRequest(req: express.Request): Promise<{ userId: string; user: UserFromToken } | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; provider?: string };
    const sub = decoded?.sub;
    if (!sub) return null;
    let user;
    if (decoded?.provider === "password") {
      user = await getUserById(sub);
    } else {
      const provider = decoded?.provider === "linkedin" ? "linkedin" : "github";
      user = await getUserByProviderId(provider, sub);
    }
    if (!user) return null;
    return {
      userId: (user as { id?: string }).id ?? "",
      user: user as UserFromToken,
    };
  } catch {
    return null;
  }
}

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

function validateUsernameFormat(username: string): { ok: boolean; message?: string } {
  const u = normalizeUsername(username);
  if (u.length < 3) return { ok: false, message: "Username must be at least 3 characters" };
  if (u.length > 20) return { ok: false, message: "Username must be at most 20 characters" };
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return { ok: false, message: "Username can only contain letters, numbers, and underscores" };
  return { ok: true };
}

const ALLOWED_INTENTS = ["Light chat", "Brainstorm", "Motivation", "Collaborate", "Networking"] as const;
function validateSelectedIntents(arr: unknown): { ok: boolean; message?: string } {
  if (!Array.isArray(arr)) return { ok: false, message: "selected_intents must be an array" };
  if (arr.length > 5) return { ok: false, message: "At most 5 intents" };
  for (const s of arr) {
    if (typeof s !== "string" || !ALLOWED_INTENTS.includes(s as (typeof ALLOWED_INTENTS)[number])) {
      return { ok: false, message: "Invalid intent; allowed: " + ALLOWED_INTENTS.join(", ") };
    }
  }
  return { ok: true };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmailFormat(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

/** Get client IP for logging/security. Optionally pass body with client_ip from frontend. */
function getClientIp(req: express.Request, body?: { client_ip?: string | null }): string | null {
  if (body?.client_ip && typeof body.client_ip === "string" && body.client_ip.trim()) return body.client_ip.trim();
  const xClientIp = req.headers["x-client-ip"];
  if (xClientIp && typeof xClientIp === "string" && xClientIp.trim()) return xClientIp.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = typeof forwarded === "string" ? forwarded.split(",")[0] : forwarded[0];
    if (first && first.trim()) return first.trim();
  }
  const xRealIp = req.headers["x-real-ip"];
  if (xRealIp && typeof xRealIp === "string" && xRealIp.trim()) return xRealIp.trim();
  const cfConnecting = req.headers["cf-connecting-ip"];
  if (cfConnecting && typeof cfConnecting === "string" && cfConnecting.trim()) return cfConnecting.trim();
  if (req.ip && typeof req.ip === "string" && req.ip.trim()) return req.ip.trim();
  const socket = (req as express.Request & { socket?: { remoteAddress?: string } }).socket;
  const addr = socket?.remoteAddress;
  if (addr && typeof addr === "string") return addr.trim();
  return null;
}

app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIMES = ["image/jpeg", "image/png", "image/webp"];
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (
    _req: express.Request,
    file: { mimetype?: string },
    cb: (err: Error | null, acceptFile?: boolean) => void
  ) => {
    if (file.mimetype && ALLOWED_AVATAR_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

// Health must be fast and never depend on DB; used by frontend to discover auth URL
app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ status: "OK", service: "auth-service" });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({ message: "Auth service is running" });
});

/** Login with email/username + password. Returns JWT for session (provider: "password", sub: user.id). */
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email_or_username, password } = req.body ?? {};
    if (typeof email_or_username !== "string" || typeof password !== "string") {
      res.status(400).json({ message: "Missing email/username or password" });
      return;
    }
    const identifier = String(email_or_username).trim();
    if (!identifier) {
      res.status(400).json({ message: "Missing email/username or password" });
      return;
    }
    if (!supabase) {
      console.error("[auth-service] Login: Supabase not configured (missing SUPABASE_URL or keys).");
      res.status(503).json({ message: "Auth service temporarily unavailable" });
      return;
    }
    const user = await getUserByEmailOrUsername(identifier);
    if (!user || !(user as { password_hash?: string | null }).password_hash) {
      console.warn("[auth-service] Login: no user or no password_hash for identifier:", identifier.replace(/@.*/, "@***"));
      res.status(401).json({ message: "Invalid email/username or password" });
      return;
    }
    const password_hash = (user as { password_hash?: string | null }).password_hash;
    const match = await bcrypt.compare(password, password_hash!);
    if (!match) {
      console.warn("[auth-service] Login: password mismatch for user id:", (user as { id?: string }).id);
      res.status(401).json({ message: "Invalid email/username or password" });
      return;
    }
    const userId = (user as { id?: string }).id;
    if (!userId) {
      res.status(500).json({ message: "Invalid user record" });
      return;
    }
    const jwtToken = jwt.sign(
      { sub: userId, provider: "password" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    console.log("[auth-service] Login: success for user id:", userId, "username:", (user as { username?: string }).username ?? "(none)");
    res.json({
      user: {
        id: userId,
        email: user.email,
        username: user.username ?? null,
        avatar_url: user.avatar_url ?? null,
      },
      accessToken: jwtToken,
    });
  } catch (err) {
    console.error("POST /api/auth/login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

/** Forgot password: send reset link (stub logs link in dev). Body { email }. */
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({ message: "Email is required" });
      return;
    }
    const user = await getUserByEmail(email.trim());
    if (user && (user as { id?: string }).id) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(token, 10);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await updateUserById((user as { id: string }).id, {
        password_reset_token_hash: tokenHash,
        password_reset_expires_at: expiresAt,
      });
      const origin = req.headers.origin || req.headers.referer || "http://localhost:3001";
      const resetLink = `${origin.replace(/\/$/, "")}/login/reset-password?token=${encodeURIComponent(token)}`;
      const userEmail = (user as { email?: string | null }).email;
      if (userEmail && typeof userEmail === "string" && userEmail.trim()) {
        await sendPasswordResetEmail(userEmail.trim(), resetLink);
      } else {
        console.log("[auth-service] Password reset link (no email on account, dev only):", resetLink);
      }
    }
    res.status(200).json({ message: "If an account exists, we've sent a reset link." });
  } catch (err) {
    console.error("POST /api/auth/forgot-password error:", err);
    res.status(500).json({ message: "Request failed" });
  }
});

/** Reset password: body { token, new_password }. */
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, new_password } = req.body ?? {};
    if (typeof token !== "string" || !token.trim() || typeof new_password !== "string") {
      res.status(400).json({ message: "Token and new password are required" });
      return;
    }
    if (new_password.length < 8) {
      res.status(400).json({ message: "Password must be at least 8 characters" });
      return;
    }
    const candidates = await getUsersWithActiveResetToken();
    for (const row of candidates) {
      const hash = (row as { password_reset_token_hash?: string | null }).password_reset_token_hash;
      if (!hash) continue;
      const match = await bcrypt.compare(token.trim(), hash);
      if (match && row.id) {
        const password_hash = await bcrypt.hash(new_password, 10);
        await updateUserById(row.id, {
          password_hash,
          password_reset_token_hash: null,
          password_reset_expires_at: null,
        });
        return res.status(200).json({ message: "Password reset successfully." });
      }
    }
    res.status(400).json({ message: "Invalid or expired reset link." });
  } catch (err) {
    console.error("POST /api/auth/reset-password error:", err);
    res.status(500).json({ message: "Reset failed" });
  }
});

app.post("/api/auth/github/callback", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      res.status(400).json({ message: "Missing or invalid code" });
      return;
    }
    const normalizedCode = code.trim();
    const cached = getCachedGitHubResult(normalizedCode);
    if (cached) {
      return res.json({ user: cached.user, accessToken: cached.jwt });
    }

    let pending = githubCodePending.get(normalizedCode);
    if (pending) {
      try {
        const result = await pending;
        return res.json({ user: result.user, accessToken: result.jwt });
      } catch {
        githubCodePending.delete(normalizedCode);
      }
    }

    const runExchange = async (): Promise<{ user: object; jwt: string }> => {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw Object.assign(new Error("GitHub OAuth not configured"), { status: 500 });
      }
      const tokenRes = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id: clientId,
          client_secret: clientSecret,
          code: normalizedCode,
          redirect_uri: REDIRECT_URI,
        },
        { headers: { Accept: "application/json" }, timeout: 10000 }
      );
      const rawToken = tokenRes.data?.access_token;
      if (!rawToken) {
        throw Object.assign(new Error(tokenRes.data?.error_description || "GitHub token exchange failed"), { status: 401 });
      }
      const accessToken = String(rawToken).trim();

      const headers = {
        Accept: "application/vnd.github+json" as const,
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${accessToken}`,
      };
      type GhProfile = { id?: number; login?: string; name?: string; email?: string | null; avatar_url?: string | null; public_repos?: number };

      /** Fetch /user with retries: GitHub can return 401 briefly after token exchange (eventual consistency). */
      async function fetchGitHubUser(token: string): Promise<GhProfile> {
        const delaysMs = [0, 500, 1500, 3500];
        let lastErr: unknown;
        for (let i = 0; i < delaysMs.length; i++) {
          if (i > 0) await delay(delaysMs[i]);
          try {
            const r = await axios.get<GhProfile>("https://api.github.com/user", {
              headers: { ...headers, Authorization: `Bearer ${token}` },
              timeout: 12000,
            });
            return r.data;
          } catch (e) {
            lastErr = e;
            const status = (e as { response?: { status?: number } })?.response?.status;
            if (status === 401 && i < delaysMs.length - 1) continue;
            if (status !== 401) throw e;
          }
        }
        const msg = (lastErr as { response?: { data?: { message?: string } } })?.response?.data?.message;
        console.error("[auth-service] GitHub /user 401 after retries:", msg ?? lastErr);
        throw lastErr;
      }

      await delay(400);

      let profile: GhProfile;
      try {
        profile = await fetchGitHubUser(accessToken);
      } catch (userErr: unknown) {
        const status = (userErr as { response?: { status?: number } })?.response?.status;
        const msg = (userErr as { response?: { data?: { message?: string } } })?.response?.data?.message;
        if (status === 401) {
          throw Object.assign(new Error("GitHub returned bad credentials. Ensure your GitHub OAuth app callback URL matches exactly and try again."), { status: 401 });
        }
        console.error("[auth-service] GitHub /user error:", msg ?? userErr);
        throw Object.assign(new Error(String(msg ?? "Failed to load GitHub profile")), { status: 500 });
      }
      const githubId = String(profile.id);
      const login = profile.login ?? "";
      const email = profile.email ?? null;
      const avatarUrl = profile.avatar_url ?? null;
      const githubUrl = login ? `https://github.com/${login}` : "";
      const userIp = getClientIp(req, req.body);

      try {
        const userId = await upsertUserByGitHub(
          {
            github_id: githubId,
            github_url: githubUrl,
            email: email ?? null,
            avatar_url: avatarUrl ?? null,
          },
          userIp
        );
        console.log(`[auth-service] GitHub verified: ${login} (id=${githubId}). User data ${userId ? "saved" : "skipped (no DB)"} in Supabase users table.`);
      } catch (dbErr) {
        console.error("[auth-service] Supabase upsert (GitHub) failed:", dbErr);
      }

      const user = {
        id: githubId,
        login,
        avatar_url: avatarUrl,
        email,
      };
      const jwtToken = jwt.sign(
        { sub: user.id, provider: "github", login: user.login },
        JWT_SECRET,
        { expiresIn: "7d" }
      );
      setCachedGitHubResult(normalizedCode, user, jwtToken);
      return { user, jwt: jwtToken };
    };

    const promise = runExchange();
    githubCodePending.set(normalizedCode, promise);
    try {
      const result = await promise;
      return res.json({ user: result.user, accessToken: result.jwt });
    } catch (err: unknown) {
      githubCodePending.delete(normalizedCode);
      const status = (err as { status?: number })?.status;
      const message = err instanceof Error ? err.message : "GitHub authentication failed";
      if (typeof status === "number" && status >= 400) {
        return res.status(status).json({ message });
      }
      console.error("GitHub callback error:", err);
      return res.status(500).json({ message: String(message) });
    }
  } catch (err: unknown) {
    console.error("GitHub callback error:", err);
    const ax = err as { response?: { status?: number; data?: { message?: string; error_description?: string; error?: string } } };
    const data = ax?.response?.data;
    const status = ax?.response?.status;
    const message = data?.message ?? data?.error_description ?? data?.error ?? "GitHub authentication failed";
    res.status(status && status >= 400 ? status : 500).json({ message: String(message) });
  }
});

app.post("/api/auth/linkedin/callback", async (req, res) => {
  try {
    const { code, code_verifier: codeVerifier } = req.body;
    if (!code || typeof code !== "string") {
      res.status(400).json({ message: "Missing or invalid code" });
      return;
    }
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(500).json({ message: "LinkedIn OAuth not configured" });
      return;
    }
    const params: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
    };
    if (codeVerifier && typeof codeVerifier === "string") {
      params.code_verifier = codeVerifier;
    }
    const tokenRes = await axios.post(
      "https://www.linkedin.com/oauth/v2/accessToken",
      new URLSearchParams(params).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    const accessToken = tokenRes.data?.access_token;
    if (!accessToken) {
      res.status(401).json({ message: "LinkedIn token exchange failed" });
      return;
    }
    const profileRes = await axios.get("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    const profile = profileRes.data;
    const linkedinId = profile?.sub;
    if (!linkedinId || typeof linkedinId !== "string") {
      res.status(401).json({ message: "LinkedIn profile could not be loaded. Please try again or sign in with GitHub or username." });
      return;
    }
    const name = profile?.name ?? profile?.given_name ?? "User";
    const email = profile?.email ?? null;
    const picture = profile?.picture ?? null;

    let linkedinUrl: string | null = null;
    try {
      const meRes = await axios.get("https://api.linkedin.com/v2/me?projection=(id,vanityName)", {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 8000,
      });
      const vanity = meRes.data?.vanityName;
      if (vanity) linkedinUrl = `https://www.linkedin.com/in/${vanity}`;
    } catch {
      // optional; vanityName may require r_basicprofile scope
    }
    if (!linkedinUrl && linkedinId) {
      linkedinUrl = `https://www.linkedin.com/in/id-${linkedinId}`;
    }

    if (email && typeof email === "string" && email.trim()) {
      const existingByEmail = await getUserByEmail(email.trim());
      if (existingByEmail && (existingByEmail as { github_id?: string | null }).github_id && !(existingByEmail as { linkedin_id?: string | null }).linkedin_id) {
        return res.status(403).json({
          message: "Sign in with GitHub or username. Add LinkedIn in your profile to use LinkedIn sign-in.",
          code: "LINKEDIN_NOT_IN_PROFILE",
        });
      }
    }

    const userIp = getClientIp(req, req.body);
    try {
      const userId = await upsertUserByLinkedIn(
        {
          linkedin_id: linkedinId,
          linkedin_url: linkedinUrl,
          email: email ?? null,
          avatar_url: picture ?? null,
        },
        userIp
      );
      console.log(`[auth-service] LinkedIn verified: ${name} (id=${linkedinId}). User data ${userId ? "saved" : "skipped (no DB)"} in Supabase users table.`);
    } catch (dbErr) {
      console.error("[auth-service] Supabase upsert (LinkedIn) failed:", dbErr);
    }

    const user = {
      id: linkedinId,
      name,
      picture,
      email,
    };
    const jwtToken = jwt.sign(
      { sub: user.id, provider: "linkedin" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ user, accessToken: jwtToken });
  } catch (err: unknown) {
    console.error("LinkedIn callback error:", err);
    const ax = err as { response?: { status?: number; data?: unknown } };
    const data = ax?.response?.data;
    const status = ax?.response?.status;
    const dataObj = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    const message =
      (typeof dataObj?.error_description === "string" && dataObj.error_description) ||
      (typeof dataObj?.message === "string" && dataObj.message) ||
      (typeof dataObj?.error === "string" && dataObj.error) ||
      "Sign in with GitHub or username if you already have an account, or try again.";
    res.status(status && status >= 400 ? status : 500).json({ message: String(message) });
  }
});

/** Return redirectUrl: /profile-setup if user has no username, else /dashboard. Requires Bearer token. Supports password and OAuth tokens. */
app.post("/api/auth/continue", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; provider?: string };
    const sub = decoded?.sub;
    if (!sub) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }
    let user;
    if (decoded?.provider === "password") {
      user = await getUserById(sub);
    } else {
      const provider = decoded?.provider === "linkedin" ? "linkedin" : "github";
      user = await getUserByProviderId(provider, sub);
    }
    if (!user) {
      res.status(404).json({ message: "User profile not found" });
      return;
    }
    const username = (user as { username?: string | null }).username;
    const redirectUrl = username && String(username).trim() ? "/dashboard" : "/profile-setup";
    res.json({ redirectUrl });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }
    console.error("POST /api/auth/continue error:", err);
    res.status(500).json({ message: "Failed to determine redirect" });
  }
});

/** Logout: optional Bearer token; always returns 200. Client clears local storage and redirects to sign-in. */
app.post("/api/auth/logout", (_req, res) => {
  res.status(200).json({ ok: true });
});

/** Get current user from DB (e.g. for dashboard). Requires Authorization: Bearer <jwt>. */
app.get("/api/users/me", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const { user } = current;
    res.json({
      id: current.userId,
      email: user.email,
      avatar_url: user.avatar_url,
      github_id: user.github_id,
      github_url: user.github_url,
      linkedin_id: user.linkedin_id,
      linkedin_url: user.linkedin_url,
      username: user.username ?? null,
      selected_intents: user.selected_intents ?? null,
      bio: user.bio ?? null,
      profession: user.profession ?? null,
    });
  } catch (err) {
    console.error("GET /api/users/me error:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
});

/** Update current user profile. Requires Bearer token. Body: username?, email?, avatar_url?, bio?, github_url?, linkedin_url?, selected_intents?, profession?. */
app.patch("/api/users/me", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const body = req.body ?? {};
    const payload: Parameters<typeof updateUserById>[1] = {};

    if (body.username !== undefined) {
      const raw = typeof body.username === "string" ? body.username : "";
      const username = normalizeUsername(raw);
      if (username.length < 3) {
        return res.status(400).json({ message: "Username must be at least 3 characters" });
      }
      const validation = validateUsernameFormat(raw);
      if (!validation.ok) {
        return res.status(400).json({ message: validation.message ?? "Invalid username" });
      }
      const available = await checkUsernameAvailable(username, current.userId);
      if (!available) {
        return res.status(400).json({ message: "Username is already taken" });
      }
      payload.username = username;
    }
    if (body.email !== undefined) {
      const e = typeof body.email === "string" ? body.email.trim() : "";
      if (!e) {
        return res.status(400).json({ message: "Email is required" });
      }
      if (!validateEmailFormat(e)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      payload.email = e;
    }
    if (body.avatar_url !== undefined) payload.avatar_url = typeof body.avatar_url === "string" ? body.avatar_url : null;
    if (body.bio !== undefined) payload.bio = typeof body.bio === "string" ? body.bio.slice(0, 500) : null;
    if (body.github_url !== undefined) payload.github_url = typeof body.github_url === "string" ? body.github_url : null;
    if (body.linkedin_url !== undefined) payload.linkedin_url = typeof body.linkedin_url === "string" ? body.linkedin_url : null;
    if (body.profession !== undefined) payload.profession = typeof body.profession === "string" ? body.profession.slice(0, 100) : null;
    if (body.selected_intents !== undefined) {
      const v = validateSelectedIntents(body.selected_intents);
      if (!v.ok) return res.status(400).json({ message: v.message });
      payload.selected_intents = body.selected_intents;
    }

    if (Object.keys(payload).length === 0) {
      const { user } = current;
      return res.json({
        id: current.userId,
        email: user.email,
        avatar_url: user.avatar_url,
        github_id: user.github_id,
        github_url: user.github_url,
        linkedin_id: user.linkedin_id,
        linkedin_url: user.linkedin_url,
        username: user.username ?? null,
        selected_intents: user.selected_intents ?? null,
        bio: user.bio ?? null,
        profession: user.profession ?? null,
      });
    }

    const updated = await updateUserById(current.userId, payload);
    if (!updated) {
      return res.status(500).json({ message: "Failed to update profile" });
    }
    const user = await getUserById(current.userId);
    if (!user) {
      return res.status(500).json({ message: "Profile updated but could not load user" });
    }
    const u = user as UserFromToken;
    res.json({
      id: current.userId,
      email: u.email,
      avatar_url: u.avatar_url,
      github_id: u.github_id,
      github_url: u.github_url,
      linkedin_id: u.linkedin_id,
      linkedin_url: u.linkedin_url,
      username: u.username ?? null,
      selected_intents: u.selected_intents ?? null,
      bio: u.bio ?? null,
      profession: u.profession ?? null,
    });
  } catch (err) {
    console.error("PATCH /api/users/me error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

/** Ensure the avatars storage bucket exists (create if missing). Call before upload so migration is optional. */
async function ensureAvatarsBucket(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.storage.createBucket("avatars", {
    public: true,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (error) {
    const msg = String(error.message || "");
    if (msg.includes("already exists") || msg.includes("duplicate") || (error as { statusCode?: string }).statusCode === "409") {
      return; /* bucket already there */
    }
    console.warn("[auth-service] Avatars bucket create:", error.message);
  }
}

/** Upload avatar image. POST /api/users/me/avatar multipart with field "avatar". Resize/compress and store in Supabase Storage, update users.avatar_url. */
app.post("/api/users/me/avatar", avatarUpload.single("avatar"), async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ message: "No image file provided; use multipart field 'avatar'" });
      return;
    }
    if (!supabase) {
      res.status(500).json({ message: "Storage not configured" });
      return;
    }
    await ensureAvatarsBucket();
    const maxDim = 400;
    const quality = 80;
    let buffer: Buffer;
    try {
      const meta = await sharp(file.buffer).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      const needResize = w > maxDim || h > maxDim;
      let pipeline = sharp(file.buffer);
      if (needResize) {
        pipeline = pipeline.resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true });
      }
      buffer = await pipeline.jpeg({ quality }).toBuffer();
    } catch (err) {
      console.error("Avatar sharp error:", err);
      res.status(400).json({ message: "Invalid or unsupported image" });
      return;
    }
    const storagePath = `${current.userId}/avatar.jpg`;
    const { error: uploadErr } = await supabase.storage.from("avatars").upload(storagePath, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (uploadErr) {
      console.error("Avatar storage upload error:", uploadErr);
      res.status(500).json({ message: "Failed to upload image" });
      return;
    }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl ?? "";
    if (!publicUrl) {
      res.status(500).json({ message: "Failed to get image URL" });
      return;
    }
    const updated = await updateUserById(current.userId, { avatar_url: publicUrl });
    if (!updated) {
      res.status(500).json({ message: "Failed to update profile" });
      return;
    }
    res.json({ avatar_url: publicUrl });
  } catch (err) {
    if (err instanceof Error && err.message?.includes("File too large")) {
      res.status(400).json({ message: "Image must be 5MB or smaller" });
      return;
    }
    if (err instanceof Error && err.message?.includes("Only JPEG")) {
      res.status(400).json({ message: err.message });
      return;
    }
    console.error("POST /api/users/me/avatar error:", err);
    res.status(500).json({ message: "Failed to upload avatar" });
  }
});

/** Search users by username prefix. GET /api/users/search?username=... Requires Bearer token. */
app.get("/api/users/search", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const username = typeof req.query.username === "string" ? req.query.username : "";
    const blocked = await listBlockedIds(current.userId);
    const users = await getUsersByUsernameSearch(username, 15, current.userId, blocked);
    res.json(users.map((u) => ({ id: u.id, username: u.username ?? null, avatar_url: u.avatar_url ?? null })));
  } catch (err) {
    console.error("GET /api/users/search error:", err);
    res.status(500).json({ message: "Search failed" });
  }
});

/** List current user's connections with other user's id, username, avatar_url, connected_at. */
app.get("/api/users/me/connections", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const rows = await listConnectionsForUser(current.userId);
    if (rows.length === 0) return res.json([]);
    const { supabase: sb } = await import("./supabase-users");
    if (!sb) return res.json([]);
    const ids = rows.map((r) => r.connected_user_id);
    const { data: userRows } = await sb.from("users").select("id, username, avatar_url").in("id", ids);
    const byId = new Map((userRows ?? []).map((u: { id: string; username?: string | null; avatar_url?: string | null }) => [u.id, u]));
    const list = rows.map((r) => {
      const u = byId.get(r.connected_user_id);
      return {
        id: r.connected_user_id,
        username: u?.username ?? null,
        avatar_url: u?.avatar_url ?? null,
        connected_at: r.created_at,
      };
    });
    res.json(list);
  } catch (err) {
    console.error("GET /api/users/me/connections error:", err);
    res.status(500).json({ message: "Failed to load connections" });
  }
});

/** Send connection invite. POST body { username }. */
app.post("/api/users/me/connection-invites", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }
    const target = await getUserByUsername(username);
    if (!target || !target.id) {
      return res.status(404).json({ message: "User not found" });
    }
    if (target.id === current.userId) {
      return res.status(400).json({ message: "Cannot invite yourself" });
    }
    if (await isBlocked(current.userId, target.id)) {
      return res.status(400).json({ message: "Cannot invite this user" });
    }
    if (await isBlocked(target.id, current.userId)) {
      const name = target.username ? `@${target.username}` : "This user";
      return res.status(403).json({ message: `${name} has blocked your account` });
    }
    if (await areConnected(current.userId, target.id)) {
      return res.status(400).json({ message: "Already connected" });
    }
    if (await hasPendingInvite(current.userId, target.id)) {
      return res.status(400).json({ message: "Invite already sent" });
    }
    const created = await createInvite(current.userId, target.id);
    if (!created) return res.status(500).json({ message: "Failed to send invite" });
    res.status(201).json({ id: created.id, to_user_id: target.id, username: target.username ?? null });
  } catch (err) {
    console.error("POST /api/users/me/connection-invites error:", err);
    res.status(500).json({ message: "Failed to send invite" });
  }
});

/** List connection invites (sent and received). */
app.get("/api/users/me/connection-invites", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const invites = await listInvitesForUser(current.userId);
    const { supabase: sb } = await import("./supabase-users");
    if (!sb) return res.json([]);
    const ids = [...new Set(invites.map((i) => [i.from_user_id, i.to_user_id]).flat())].filter((id) => id !== current.userId);
    const { data: userRows } = await sb.from("users").select("id, username, avatar_url").in("id", ids);
    const byId = new Map((userRows ?? []).map((u: { id: string; username?: string | null; avatar_url?: string | null }) => [u.id, u]));
    const list = invites.map((inv) => {
      const otherId = inv.from_user_id === current.userId ? inv.to_user_id : inv.from_user_id;
      const u = byId.get(otherId);
      return {
        id: inv.id,
        from_user_id: inv.from_user_id,
        to_user_id: inv.to_user_id,
        status: inv.status,
        created_at: inv.created_at,
        direction: inv.from_user_id === current.userId ? "sent" : "received",
        other_user: { id: otherId, username: u?.username ?? null, avatar_url: u?.avatar_url ?? null },
      };
    });
    res.json(list);
  } catch (err) {
    console.error("GET /api/users/me/connection-invites error:", err);
    res.status(500).json({ message: "Failed to load invites" });
  }
});

/** Accept connection invite. */
app.post("/api/users/me/connection-invites/:id/accept", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const inviteId = req.params.id;
    const inv = await getInviteById(inviteId, current.userId);
    if (!inv || inv.to_user_id !== current.userId) {
      return res.status(404).json({ message: "Invite not found" });
    }
    if (inv.status !== "pending") {
      return res.status(400).json({ message: "Invite already handled" });
    }
    const ok = await updateInviteStatus(inviteId, "accepted");
    if (!ok) return res.status(500).json({ message: "Failed to accept" });
    await createConnection(inv.from_user_id, inv.to_user_id);
    res.json({ message: "Accepted" });
  } catch (err) {
    console.error("POST /api/users/me/connection-invites/:id/accept error:", err);
    res.status(500).json({ message: "Failed to accept invite" });
  }
});

/** Reject connection invite. */
app.post("/api/users/me/connection-invites/:id/reject", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const inviteId = req.params.id;
    const inv = await getInviteById(inviteId, current.userId);
    if (!inv || inv.to_user_id !== current.userId) {
      return res.status(404).json({ message: "Invite not found" });
    }
    if (inv.status !== "pending") {
      return res.status(400).json({ message: "Invite already handled" });
    }
    const ok = await updateInviteStatus(inviteId, "rejected");
    if (!ok) return res.status(500).json({ message: "Failed to reject" });
    res.json({ message: "Rejected" });
  } catch (err) {
    console.error("POST /api/users/me/connection-invites/:id/reject error:", err);
    res.status(500).json({ message: "Failed to reject invite" });
  }
});

/** Remove connection. DELETE /api/users/me/connections/:userId */
app.delete("/api/users/me/connections/:userId", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const otherId = req.params.userId;
    if (!otherId) return res.status(400).json({ message: "User id required" });
    const connected = await areConnected(current.userId, otherId);
    if (!connected) return res.status(404).json({ message: "Not connected" });
    const ok = await deleteConnection(current.userId, otherId);
    if (!ok) return res.status(500).json({ message: "Failed to disconnect" });
    res.json({ message: "Disconnected" });
  } catch (err) {
    console.error("DELETE /api/users/me/connections/:userId error:", err);
    res.status(500).json({ message: "Failed to disconnect" });
  }
});

/** List users the current user has blocked. GET /api/users/me/blocks */
app.get("/api/users/me/blocks", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const blockedIds = await listBlockedIds(current.userId);
    if (blockedIds.length === 0) {
      return res.json([]);
    }
    const { data: rows } = await supabase!.from("users").select("id, username, avatar_url").in("id", blockedIds);
    const list = (rows ?? []).map((r: { id: string; username?: string | null; avatar_url?: string | null }) => ({
      id: r.id,
      username: r.username ?? null,
      avatar_url: r.avatar_url ?? null,
    }));
    res.json(list);
  } catch (err) {
    console.error("GET /api/users/me/blocks error:", err);
    res.status(500).json({ message: "Failed to load blocked users" });
  }
});

/** Block a user. POST body { user_id }. */
app.post("/api/users/me/blocks", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const userId = typeof req.body?.user_id === "string" ? req.body.user_id.trim() : "";
    if (!userId) return res.status(400).json({ message: "user_id is required" });
    if (userId === current.userId) return res.status(400).json({ message: "Cannot block yourself" });
    await deleteConnection(current.userId, userId);
    const ok = await createBlock(current.userId, userId);
    if (!ok) return res.status(500).json({ message: "Failed to block" });
    res.status(201).json({ message: "Blocked" });
  } catch (err) {
    console.error("POST /api/users/me/blocks error:", err);
    res.status(500).json({ message: "Failed to block" });
  }
});

/** Unblock a user. DELETE /api/users/me/blocks/:userId */
app.delete("/api/users/me/blocks/:userId", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const blockedId = req.params.userId;
    if (!blockedId) return res.status(400).json({ message: "User id required" });
    const ok = await deleteBlock(current.userId, blockedId);
    if (!ok) return res.status(404).json({ message: "Not blocked" });
    res.json({ message: "Unblocked" });
  } catch (err) {
    console.error("DELETE /api/users/me/blocks/:userId error:", err);
    res.status(500).json({ message: "Failed to unblock" });
  }
});

/** Check if username is available. Requires Bearer token, body { username }. */
app.post("/api/users/check-username", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const raw = req.body?.username;
    if (typeof raw !== "string") {
      res.status(400).json({ message: "Missing or invalid username" });
      return;
    }
    const username = normalizeUsername(raw);
    if (username.length < 3) {
      return res.json({ available: false });
    }
    const validation = validateUsernameFormat(raw);
    if (!validation.ok) {
      return res.json({ available: false });
    }
    const available = await checkUsernameAvailable(username, current.userId);
    res.json({ available });
  } catch (err) {
    console.error("POST /api/users/check-username error:", err);
    res.status(500).json({ message: "Failed to check username" });
  }
});

/** Save username and password (profile setup). Requires Bearer token, body { username, password }. */
app.post("/api/auth/profile-setup", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const { username: rawUsername, password } = req.body ?? {};
    if (typeof rawUsername !== "string" || typeof password !== "string") {
      res.status(400).json({ message: "Missing username or password" });
      return;
    }
    const validation = validateUsernameFormat(rawUsername);
    if (!validation.ok) {
      res.status(400).json({ message: validation.message ?? "Invalid username" });
      return;
    }
    const username = normalizeUsername(rawUsername);
    const available = await checkUsernameAvailable(username, current.userId);
    if (!available) {
      res.status(400).json({ message: "Username is already taken" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ message: "Password must be at least 8 characters" });
      return;
    }
    const password_hash = await bcrypt.hash(password, 10);
    const updated = await updateUserById(current.userId, { username, password_hash });
    if (!updated) {
      res.status(500).json({ message: "Failed to save profile" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/auth/profile-setup error:", err);
    res.status(500).json({ message: "Failed to save profile" });
  }
});

/** Get current user's settings (permission toggles). GET /api/users/me/settings */
app.get("/api/users/me/settings", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    if (!supabase) return res.status(503).json({ message: "Settings unavailable" });
    const { data } = await supabase.from("user_settings").select("*").eq("user_id", current.userId).maybeSingle();
    const defaults = {
      camera_allowed: true,
      microphone_allowed: true,
      notifications_allowed: true,
      location_allowed: false,
      popups_redirects_allowed: false,
      sound_allowed: true,
      auto_verify: false,
      on_device_site_data: true,
    };
    res.json(data ?? defaults);
  } catch (err) {
    console.error("GET /api/users/me/settings error:", err);
    res.status(500).json({ message: "Failed to load settings" });
  }
});

/** Update current user's settings. PATCH /api/users/me/settings */
app.patch("/api/users/me/settings", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    if (!supabase) return res.status(503).json({ message: "Settings unavailable" });
    const body = req.body ?? {};
    const allowed = [
      "camera_allowed",
      "microphone_allowed",
      "notifications_allowed",
      "location_allowed",
      "popups_redirects_allowed",
      "sound_allowed",
      "auto_verify",
      "on_device_site_data",
    ] as const;
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (typeof body[key] === "boolean") payload[key] = body[key];
    }
    if (Object.keys(payload).length <= 1) return res.status(400).json({ message: "No valid settings to update" });
    const row = { user_id: current.userId, ...payload };
    const { error } = await supabase.from("user_settings").upsert(row, { onConflict: "user_id" });
    if (error) {
      console.error("PATCH user_settings error:", error);
      return res.status(500).json({ message: "Failed to save settings" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/users/me/settings error:", err);
    res.status(500).json({ message: "Failed to save settings" });
  }
});

/** Submit a report (harassment, fraud, etc). POST /api/reports */
app.post("/api/reports", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    if (!supabase) return res.status(503).json({ message: "Reports unavailable" });
    const { type, description, target_user_id, target_type } = req.body ?? {};
    const validTypes = ["harassment", "fraud", "spam", "other"];
    const t = typeof type === "string" ? type.trim().toLowerCase() : "";
    if (!validTypes.includes(t)) {
      return res.status(400).json({ message: "Invalid report type. Use: harassment, fraud, spam, other" });
    }
    const { error } = await supabase.from("reports").insert({
      reporter_id: current.userId,
      type: t,
      description: typeof description === "string" ? description.trim().slice(0, 2000) : null,
      target_user_id: typeof target_user_id === "string" ? target_user_id.trim() || null : null,
      target_type: typeof target_type === "string" ? target_type.trim().slice(0, 100) : null,
    });
    if (error) {
      console.error("POST reports error:", error);
      return res.status(500).json({ message: "Failed to submit report" });
    }
    res.status(201).json({ success: true, message: "Report submitted" });
  } catch (err) {
    console.error("POST /api/reports error:", err);
    res.status(500).json({ message: "Failed to submit report" });
  }
});

/** Contact us form. POST /api/contact */
app.post("/api/contact", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!supabase) return res.status(503).json({ message: "Contact form unavailable" });
    const { name, email, message } = req.body ?? {};
    const n = typeof name === "string" ? name.trim().slice(0, 200) : "";
    const e = typeof email === "string" ? email.trim().slice(0, 256) : "";
    const m = typeof message === "string" ? message.trim().slice(0, 5000) : "";
    if (!n || !e || !m) return res.status(400).json({ message: "Name, email, and message are required" });
    const { error } = await supabase.from("contact_requests").insert({
      user_id: current?.userId ?? null,
      name: n,
      email: e,
      message: m,
    });
    if (error) {
      console.error("POST contact_requests error:", error);
      return res.status(500).json({ message: "Failed to send message" });
    }
    res.status(201).json({ success: true, message: "Message sent" });
  } catch (err) {
    console.error("POST /api/contact error:", err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

/** Origin used to build invite links for this request. */
function inviteOrigin(req: express.Request): string {
  return requestOrigin(req.get("origin"), req.get("referer"));
}

/** Shape huddles for output with participant counts from a single query. */
async function toPublicHuddles(rows: HuddleRow[], viewerId: string) {
  const counts = await getParticipantCounts(rows.map((h) => h.id));
  return rows.map((h) => toPublicHuddle(h, viewerId, counts.get(h.id) ?? 0));
}

/** Invite code sent by the client, from the JSON body or the ?code= query. */
function providedInviteCode(req: express.Request): unknown {
  const fromBody = (req.body as { code?: unknown } | undefined)?.code;
  return fromBody ?? req.query.code;
}

/** GET /api/huddles/active – list active (live) huddles for dashboard. */
app.get("/api/huddles/active", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const rows = await listActiveHuddles(current.userId);
    const huddles = await toPublicHuddles(rows, current.userId);
    res.json(
      huddles.map((h) => ({
        ...h,
        topic: h.title,
        canJoin: h.participants_count < h.max_participants,
      }))
    );
  } catch (err) {
    console.error("GET /api/huddles/active error:", err);
    res.status(500).json({ message: "Failed to list huddles" });
  }
});

/** GET /api/huddles?category=trendy|live|all – list trendy and live huddles. */
app.get("/api/huddles", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const category = parseCategory(req.query.category);
    const { trendy, live } = await listHuddles(category, current.userId);
    res.json({
      trendy: await toPublicHuddles(trendy, current.userId),
      live: await toPublicHuddles(live, current.userId),
    });
  } catch (err) {
    console.error("GET /api/huddles error:", err);
    res.status(500).json({ message: "Failed to list huddles" });
  }
});

/** POST /api/huddles – create a huddle. */
app.post("/api/huddles", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const validation = validateCreateHuddleInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ message: validation.message });
      return;
    }
    const row = await createHuddle(current.userId, validation.value);
    res.status(201).json({
      ...toPublicHuddle(row, current.userId, 0),
      invite_url: buildInviteUrl(inviteOrigin(req), row),
    });
  } catch (err) {
    console.error("POST /api/huddles error:", err);
    res.status(500).json({ message: "Failed to create huddle" });
  }
});

/**
 * GET /api/huddles/:id[?code=] – get one huddle.
 * Private huddles are only visible to the creator, current participants, or holders of
 * the invite code. Everyone else gets 404 so private huddle ids cannot be probed.
 */
app.get("/api/huddles/:id", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const id = req.params.id;
    const row = await getHuddleById(id);
    if (!row) {
      res.status(404).json({ message: "Huddle not found" });
      return;
    }
    const isParticipant = await isActiveParticipant(id, current.userId);
    if (!canAccessHuddle(row, { viewerId: current.userId, isParticipant, inviteCode: providedInviteCode(req) })) {
      res.status(404).json({ message: "Huddle not found" });
      return;
    }
    const huddle = toPublicHuddle(row, current.userId, await getHuddleParticipantCount(id));
    const canShareInvite = row.type !== "private" || huddle.is_owner;
    res.json({
      ...huddle,
      is_participant: isParticipant,
      invite_url: canShareInvite ? buildInviteUrl(inviteOrigin(req), row) : "",
    });
  } catch (err) {
    console.error("GET /api/huddles/:id error:", err);
    res.status(500).json({ message: "Failed to get huddle" });
  }
});

/** POST /api/huddles/:id/join – join a huddle. Body or query may carry { code } for private huddles. */
app.post("/api/huddles/:id/join", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const id = req.params.id;
    const row = await getHuddleById(id);
    if (!row) {
      res.status(404).json({ message: "Huddle not found" });
      return;
    }
    const isParticipant = await isActiveParticipant(id, current.userId);
    if (!canAccessHuddle(row, { viewerId: current.userId, isParticipant, inviteCode: providedInviteCode(req) })) {
      res.status(404).json({ message: "Huddle not found" });
      return;
    }
    const result = await joinHuddle(id, current.userId);
    if (!result.ok) {
      res.status(result.reason === "not_found" ? 404 : 409).json({ message: result.message });
      return;
    }
    res.json({ huddle_id: id, user_id: current.userId, joined_at: new Date().toISOString() });
  } catch (err) {
    console.error("POST /api/huddles/:id/join error:", err);
    res.status(500).json({ message: "Failed to join huddle" });
  }
});

/** Permanently delete account. DELETE /api/users/me */
app.delete("/api/users/me", async (req, res) => {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!current) {
      res.status(401).json({ message: "Missing or invalid authorization" });
      return;
    }
    const userId = current.userId;
    if (supabase) {
      const { error: deleteRowErr } = await supabase.from("users").delete().eq("id", userId);
      if (deleteRowErr) {
        console.error("DELETE users error:", deleteRowErr);
        return res.status(500).json({ message: "Failed to delete account" });
      }
      try {
        const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
        if (authErr) console.error("[auth-service] auth.admin.deleteUser error:", authErr);
      } catch (authErr) {
        console.error("[auth-service] auth.admin.deleteUser exception:", authErr);
      }
    }
    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    console.error("DELETE /api/users/me error:", err);
    res.status(500).json({ message: "Failed to delete account" });
  }
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const multerErr = err as { code?: string; message?: string; field?: string };
  if (multerErr?.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ message: "Image must be 5MB or smaller" });
    return;
  }
  if (err instanceof Error && err.message?.includes("Only JPEG")) {
    res.status(400).json({ message: err.message });
    return;
  }
  next(err);
});

const server = http.createServer(app);

// Allow slow requests (e.g. Supabase) to complete; default would allow client to abort first
server.requestTimeout = 0;
server.headersTimeout = 60_000;

// Tear down socket on client disconnect/timeout without logging (expected when client aborts or navigates away)
server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
  if (err.code === "ECONNRESET" || err.code === "EPIPE" || err.code === "ERR_HTTP_REQUEST_TIMEOUT") {
    socket.destroy();
    return;
  }
  console.error("[auth-service] clientError:", err.code || err.message);
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Auth service running on port ${PORT}`);
});
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use. Free it with (PowerShell):`);
    console.error(`  Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n`);
    process.exit(1);
  }
  throw err;
});
