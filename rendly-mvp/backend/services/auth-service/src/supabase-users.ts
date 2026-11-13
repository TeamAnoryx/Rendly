import path from "path";
import dotenv from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
};

/** Insert row; if user_ip column is missing, retry without user_ip so data is still saved. */
async function insertUserRow(row: Record<string, unknown>): Promise<{ id: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("users").insert(row).select("id").single();
  if (error) {
    const msg = String(error.message || error.code || "");
    if (error.code === "42703" || msg.includes("user_ip") || msg.includes("column")) {
      const { user_ip: _u, ...rowWithoutIp } = row;
      const retry = await supabase.from("users").insert(rowWithoutIp).select("id").single();
      if (retry.error) throw retry.error;
      return retry.data as { id: string };
    }
    throw error;
  }
  return data as { id: string };
}

/** Create an email + password user (company email sign-up). Email must already be validated and lowercased. */
export async function insertUserWithPassword(payload: {
  email: string;
  password_hash: string;
}): Promise<{ id: string } | null> {
  return insertUserRow({ email: payload.email, password_hash: payload.password_hash });
}

/** Upsert user by GitHub id. Single-provider: no merge with LinkedIn. */
export async function upsertUserByGitHub(
  payload: {
    github_id: string;
    github_url: string;
    email: string | null;
    avatar_url: string | null;
  },
  userIp: string | null
): Promise<string | null> {
  if (!supabase) return null;
  const { data: byGithub } = await supabase.from("users").select("id").eq("github_id", payload.github_id).maybeSingle();
  const { data: byEmail } =
    payload.email != null ? await supabase.from("users").select("id, email, avatar_url").eq("email", payload.email).maybeSingle() : { data: null };
  const existing = byGithub ?? byEmail;
  const row: Record<string, unknown> = {
    github_id: payload.github_id,
    github_url: payload.github_url,
    email: payload.email ?? byEmail?.email ?? null,
    avatar_url: payload.avatar_url ?? byEmail?.avatar_url ?? null,
    updated_at: new Date().toISOString(),
  };
  if (userIp && userIp.trim()) row.user_ip = userIp.trim();

  if (existing?.id) {
    const { error } = await supabase.from("users").update(row).eq("id", existing.id);
    if (error) {
      if (error.code === "42703" || String(error.message).includes("user_ip")) {
        const { user_ip: _u, ...rowWithoutIp } = row;
        const err2 = await supabase.from("users").update(rowWithoutIp).eq("id", existing.id);
        if (err2.error) throw err2.error;
      } else throw error;
    }
    return existing.id;
  }

  const data = await insertUserRow(row);
  return data?.id ?? null;
}

/** Upsert user by LinkedIn id. Single-provider: no link to GitHub. */
export async function upsertUserByLinkedIn(
  payload: {
    linkedin_id: string;
    linkedin_url: string | null;
    email: string | null;
    avatar_url: string | null;
  },
  userIp: string | null
): Promise<string | null> {
  if (!supabase) return null;

  const { data: byLinkedIn } = await supabase.from("users").select("id").eq("linkedin_id", payload.linkedin_id).maybeSingle();
  const { data: byEmail } =
    payload.email != null ? await supabase.from("users").select("id, email, avatar_url").eq("email", payload.email).maybeSingle() : { data: null };
  const existing = byLinkedIn ?? byEmail;
  const row: Record<string, unknown> = {
    linkedin_id: payload.linkedin_id,
    linkedin_url: payload.linkedin_url,
    email: payload.email ?? byEmail?.email ?? null,
    avatar_url: payload.avatar_url ?? byEmail?.avatar_url ?? null,
    updated_at: new Date().toISOString(),
  };
  if (userIp && userIp.trim()) row.user_ip = userIp.trim();

  if (existing?.id) {
    const { error } = await supabase.from("users").update(row).eq("id", existing.id);
    if (error) {
      if (error.code === "42703" || String(error.message).includes("user_ip")) {
        const { user_ip: _u, ...rowWithoutIp } = row;
        const err2 = await supabase.from("users").update(rowWithoutIp).eq("id", existing.id);
        if (err2.error) throw err2.error;
      } else throw error;
    }
    return existing.id;
  }

  const data = await insertUserRow(row);
  return data?.id ?? null;
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
    const { data } = await supabase.from("users").select("*").eq("email", raw).maybeSingle();
    return data as UserRow | null;
  }
  const username = raw.replace(/^@/, "");
  if (username.length < 3) return null;
  const { data } = await supabase.from("users").select("*").eq("username", username).maybeSingle();
  return data as UserRow | null;
}

/** Get user by email only (for LinkedIn guard, forgot-password). */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  if (!supabase || !email || typeof email !== "string" || !email.trim()) return null;
  const { data } = await supabase.from("users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  return data as UserRow | null;
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
  if (payload.email !== undefined) row.email = payload.email;
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
