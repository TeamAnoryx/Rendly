import path from "path";
import dotenv from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeEmail as normalizeEmailValue,
  escapeLikePattern,
  resolveOAuthSignIn,
  type LinkCandidate,
  type OAuthProvider,
} from "./account-linking";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

if (!supabase && (supabaseUrl || supabaseKey)) {
  console.warn("[auth-service] Supabase: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; user data will not be saved to DB.");
}

/** Users table: id, email, avatar_url, github_id, github_url, linkedin_id, linkedin_url, created_at, updated_at, user_ip, username, password_hash, selected_intents, bio, profession, password_reset_* */
export type UserRow = {
  id?: string;
  email: string | null;
  avatar_url: string | null;
  github_id: string | null;
  github_url: string | null;
  linkedin_id: string | null;
  linkedin_url: string | null;
  created_at?: string;
  updated_at?: string;
  user_ip: string | null;
  username?: string | null;
  password_hash?: string | null;
  selected_intents?: string[] | null;
  bio?: string | null;
  profession?: string | null;
  password_reset_token_hash?: string | null;
  password_reset_expires_at?: string | null;
  email_verified?: boolean | null;
};

/** Columns added by later migrations; dropped and retried if the DB does not have them yet. */
const OPTIONAL_COLUMNS = ["user_ip", "email_verified"] as const;

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = String(error.message || "");
  return error.code === "42703" || OPTIONAL_COLUMNS.some((c) => msg.includes(c));
}

function withoutOptionalColumns(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  for (const c of OPTIONAL_COLUMNS) delete copy[c];
  return copy;
}

/** Insert row; if an optional column (user_ip, email_verified) is missing, retry without it. */
async function insertUserRow(row: Record<string, unknown>): Promise<{ id: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("users").insert(row).select("id").single();
  if (error) {
    if (isMissingColumnError(error)) {
      const retry = await supabase.from("users").insert(withoutOptionalColumns(row)).select("id").single();
      if (retry.error) throw retry.error;
      return retry.data as { id: string };
    }
    throw error;
  }
  return data as { id: string };
}

async function updateUserRow(userId: string, row: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("users").update(row).eq("id", userId);
  if (!error) return;
  if (isMissingColumnError(error)) {
    const retry = await supabase.from("users").update(withoutOptionalColumns(row)).eq("id", userId);
    if (retry.error) throw retry.error;
    return;
  }
  throw error;
}

/** Create an email + password user. The email is normalised (trim + lowercase) here as well. */
export async function insertUserWithPassword(payload: {
  email: string;
  password_hash: string;
}): Promise<{ id: string } | null> {
  const email = normalizeEmailValue(payload.email);
  if (!email) throw new Error("Invalid email");
  return insertUserRow({ email, password_hash: payload.password_hash, email_verified: false });
}

/** Up to `limit` users whose email equals `email` case-insensitively (exact match, wildcards escaped). */
export async function findUsersByEmail(email: string, limit = 2): Promise<UserRow[]> {
  const normalized = normalizeEmailValue(email);
  if (!supabase || !normalized) return [];
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .ilike("email", escapeLikePattern(normalized))
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as UserRow[];
}

function toLinkCandidate(row: UserRow): LinkCandidate {
  return {
    id: String(row.id),
    email: row.email ?? null,
    github_id: row.github_id ?? null,
    linkedin_id: row.linkedin_id ?? null,
    has_password: !!row.password_hash,
    email_verified: row.email_verified === true,
  };
}

export type OAuthSignInParams = {
  provider: OAuthProvider;
  providerId: string;
  providerUrl: string | null;
  /** Provider-verified email or null. Never pass an unverified email. */
  verifiedEmail: string | null;
  avatarUrl: string | null;
};

export type OAuthSignInResult =
  | { ok: true; userId: string | null; action: "login" | "link" | "create" }
  | { ok: false; status: 409; message: string };

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === UNIQUE_VIOLATION;
}

/**
 * One person = one account. Resolves (provider id -> verified email -> create) and applies the
 * result. Throws on DB errors; returns { ok: false } on a linking conflict.
 */
export async function signInWithOAuth(params: OAuthSignInParams, userIp: string | null): Promise<OAuthSignInResult> {
  if (!supabase) return { ok: true, userId: null, action: "create" };
  const idCol = params.provider === "github" ? "github_id" : "linkedin_id";
  const urlCol = params.provider === "github" ? "github_url" : "linkedin_url";
  const verifiedEmail = normalizeEmailValue(params.verifiedEmail);
  const ip = userIp && userIp.trim() ? userIp.trim() : null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: byIdRow, error: byIdErr } = await supabase
      .from("users")
      .select("*")
      .eq(idCol, params.providerId)
      .maybeSingle();
    if (byIdErr) throw byIdErr;
    const byEmailRows = verifiedEmail ? await findUsersByEmail(verifiedEmail, 2) : [];
    const decision = resolveOAuthSignIn({
      provider: params.provider,
      providerId: params.providerId,
      verifiedEmail,
      byProviderId: byIdRow ? toLinkCandidate(byIdRow as UserRow) : null,
      byEmail: byEmailRows.map(toLinkCandidate),
    });
    const now = new Date().toISOString();

    if (decision.action === "conflict") {
      console.warn(`[auth-service] OAuth ${params.provider} sign-in refused (conflict) for provider id ${params.providerId}`);
      return { ok: false, status: decision.status, message: decision.message };
    }

    if (decision.action === "login") {
      const existing = byIdRow as UserRow;
      const row: Record<string, unknown> = {
        [urlCol]: params.providerUrl,
        avatar_url: existing.avatar_url ?? params.avatarUrl ?? null,
        updated_at: now,
      };
      if (decision.markEmailVerified) row.email_verified = true;
      // Fill a missing email only with a provider-verified one that no other account uses.
      if (!existing.email && verifiedEmail && byEmailRows.length === 0) {
        row.email = verifiedEmail;
        row.email_verified = true;
      }
      if (ip) row.user_ip = ip;
      await updateUserRow(decision.userId, row);
      return { ok: true, userId: decision.userId, action: "login" };
    }

    if (decision.action === "link") {
      const existing = byEmailRows.find((r) => String(r.id) === decision.userId);
      const row: Record<string, unknown> = {
        [idCol]: params.providerId,
        [urlCol]: params.providerUrl,
        email: verifiedEmail,
        email_verified: true,
        avatar_url: existing?.avatar_url ?? params.avatarUrl ?? null,
        updated_at: now,
      };
      if (decision.clearPassword) {
        row.password_hash = null;
        row.password_reset_token_hash = null;
        row.password_reset_expires_at = null;
      }
      if (ip) row.user_ip = ip;
      try {
        await updateUserRow(decision.userId, row);
      } catch (err) {
        if (isUniqueViolation(err) && attempt === 0) continue;
        throw err;
      }
      if (decision.clearPassword) {
        console.warn(
          `[auth-service] Account ${decision.userId}: linked ${params.provider} by verified email and cleared an unverified password (pre-account-takeover guard).`
        );
      } else {
        console.log(`[auth-service] Account ${decision.userId}: linked ${params.provider} identity by verified email.`);
      }
      return { ok: true, userId: decision.userId, action: "link" };
    }

    const row: Record<string, unknown> = {
      [idCol]: params.providerId,
      [urlCol]: params.providerUrl,
      email: decision.email,
      email_verified: decision.email !== null,
      avatar_url: params.avatarUrl,
      updated_at: now,
    };
    if (ip) row.user_ip = ip;
    try {
      const created = await insertUserRow(row);
      return { ok: true, userId: created?.id ?? null, action: "create" };
    } catch (err) {
      // A concurrent sign-in created the row (unique provider id / lower(email)): resolve again.
      if (isUniqueViolation(err) && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("OAuth sign-in could not be resolved");
}

/** Get user by database id (for password login JWT). */
export async function getUserById(id: string): Promise<UserRow | null> {
  if (!supabase || !id || !id.trim()) return null;
  const { data } = await supabase.from("users").select("*").eq("id", id.trim()).maybeSingle();
  return data as UserRow | null;
}

/** Get user by email or username (for login). Identifier: trim, lowercase; if contains @ query by email, else by username (strip @, lowercase). */
export async function getUserByEmailOrUsername(identifier: string): Promise<UserRow | null> {
  if (!supabase || !identifier || typeof identifier !== "string") return null;
  const raw = identifier.trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("@")) {
    // Case-insensitive; ambiguous legacy duplicates resolve to null (no guessing which account).
    const rows = await findUsersByEmail(raw, 2);
    return rows.length === 1 ? rows[0] : null;
  }
  const username = raw.replace(/^@/, "");
  if (username.length < 3) return null;
  const { data } = await supabase.from("users").select("*").eq("username", username).maybeSingle();
  return data as UserRow | null;
}

/** Get user by email only (for LinkedIn guard, forgot-password). */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  if (!supabase || !email || typeof email !== "string" || !email.trim()) return null;
  // Case-insensitive; ambiguous legacy duplicates resolve to null (no guessing which account).
  const rows = await findUsersByEmail(email, 2);
  return rows.length === 1 ? rows[0] : null;
}

/** Get user by github_id or linkedin_id (for /api/users/me). */
export async function getUserByProviderId(provider: "github" | "linkedin", sub: string): Promise<UserRow | null> {
  if (!supabase) return null;
  const col = provider === "github" ? "github_id" : "linkedin_id";
  const { data } = await supabase.from("users").select("*").eq(col, sub).maybeSingle();
  return data as UserRow | null;
}

/** Update user by id. Allowed fields: email, avatar_url, github_url, linkedin_url, username, password_hash, selected_intents, bio, profession, password_reset_token_hash, password_reset_expires_at. */
export async function updateUserById(
  userId: string,
  payload: {
    email?: string | null;
    avatar_url?: string | null;
    github_url?: string | null;
    linkedin_url?: string | null;
    username?: string | null;
    password_hash?: string | null;
    selected_intents?: string[] | null;
    bio?: string | null;
    profession?: string | null;
    password_reset_token_hash?: string | null;
    password_reset_expires_at?: string | null;
  }
): Promise<boolean> {
  if (!supabase) return false;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.email !== undefined) row.email = payload.email === null ? null : normalizeEmailValue(payload.email);
  if (payload.avatar_url !== undefined) row.avatar_url = payload.avatar_url;
  if (payload.github_url !== undefined) row.github_url = payload.github_url;
  if (payload.linkedin_url !== undefined) row.linkedin_url = payload.linkedin_url;
  if (payload.username !== undefined) row.username = payload.username;
  if (payload.password_hash !== undefined) row.password_hash = payload.password_hash;
  if (payload.selected_intents !== undefined) row.selected_intents = payload.selected_intents;
  if (payload.bio !== undefined) row.bio = payload.bio;
  if (payload.profession !== undefined) row.profession = payload.profession;
  if (payload.password_reset_token_hash !== undefined) row.password_reset_token_hash = payload.password_reset_token_hash;
  if (payload.password_reset_expires_at !== undefined) row.password_reset_expires_at = payload.password_reset_expires_at;
  const { error } = await supabase.from("users").update(row).eq("id", userId).select("id").single();
  return !error;
}

/** Get users with active password reset token (not expired). Used by reset-password to find user by token. */
export async function getUsersWithActiveResetToken(): Promise<UserRow[]> {
  if (!supabase) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("users")
    .select("id, password_reset_token_hash, password_reset_expires_at")
    .not("password_reset_token_hash", "is", null)
    .gt("password_reset_expires_at", now)
    .limit(50);
  if (error) return [];
  return (data ?? []) as UserRow[];
}

/** The user holding this unexpired password-reset token hash, or null. */
export async function getUserByActiveResetTokenHash(tokenHash: string): Promise<UserRow | null> {
  if (!supabase || !tokenHash) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("password_reset_token_hash", tokenHash)
    .gt("password_reset_expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[auth-service] reset token lookup failed:", error.code ?? error.message);
    return null;
  }
  return (data as UserRow | null) ?? null;
}

/** Check if username is available (not taken by another user). Exclude current userId if provided. */
export async function checkUsernameAvailable(username: string, excludeUserId?: string | null): Promise<boolean> {
  if (!supabase || !username || !username.trim()) return false;
  const normalized = username.trim().toLowerCase().replace(/^@/, "");
  if (normalized.length < 3) return false;
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("username", normalized)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  if (!data?.id) return true;
  if (excludeUserId && data.id === excludeUserId) return true;
  return false;
}

function normalizeUsernameForQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

/** Get user by username (normalized). For connection invite and search. */
export async function getUserByUsername(username: string): Promise<UserRow | null> {
  if (!supabase || !username || !username.trim()) return null;
  const normalized = normalizeUsernameForQuery(username);
  if (normalized.length < 2) return null;
  const { data } = await supabase.from("users").select("*").eq("username", normalized).maybeSingle();
  return data as UserRow | null;
}

/** Search users by username prefix (for profile page search). Excludes excludeUserId and optionally blocked ids. */
export async function getUsersByUsernameSearch(
  prefix: string,
  limit: number,
  excludeUserId?: string | null,
  excludeUserIds: string[] = []
): Promise<UserRow[]> {
  if (!supabase || limit < 1) return [];
  const normalized = normalizeUsernameForQuery(prefix);
  if (normalized.length < 2) return [];
  let q = supabase
    .from("users")
    .select("id, username, avatar_url, email")
    .ilike("username", `${normalized}%`)
    .limit(Math.min(limit, 20));
  if (excludeUserId) q = q.neq("id", excludeUserId);
  for (const id of excludeUserIds) {
    if (id) q = q.neq("id", id);
  }
  const { data } = await q;
  return (data ?? []) as UserRow[];
}
