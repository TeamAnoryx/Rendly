import path from "path";
import dotenv from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export type UserRow = {
  id?: string;
  username?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

export async function getUserById(id: string): Promise<UserRow | null> {
  if (!supabase || !id?.trim()) return null;
  const { data } = await supabase.from("users").select("id, username, email, avatar_url").eq("id", id.trim()).maybeSingle();
  return data as UserRow | null;
}

const USER_ROW_CACHE_TTL_MS = 60_000;
const USER_ROW_CACHE_MAX = 20_000;
const userRowCache = new Map<string, { row: UserRow; expires: number }>();

/**
 * getUserById for display fields (username, avatar) on hot paths such as sending a message:
 * found rows are reused for up to 60 s, so a rename can take that long to show there.
 */
export async function getUserByIdCached(id: string): Promise<UserRow | null> {
  const key = id?.trim();
  if (!key) return null;
  const hit = userRowCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.row;
  const row = await getUserById(key);
  if (row) {
    if (userRowCache.size >= USER_ROW_CACHE_MAX) {
      const oldest = userRowCache.keys().next().value;
      if (oldest !== undefined) userRowCache.delete(oldest);
    }
    userRowCache.set(key, { row, expires: Date.now() + USER_ROW_CACHE_TTL_MS });
  }
  return row;
}

/** Batch fetch users by ids (one query). Returns a Map for quick lookup. */
export async function getUsersByIds(ids: string[]): Promise<Map<string, UserRow>> {
  const map = new Map<string, UserRow>();
  if (!supabase || ids.length === 0) return map;
  const trimmed = [...new Set(ids.map((id) => id?.trim()).filter(Boolean))] as string[];
  if (trimmed.length === 0) return map;
  const { data } = await supabase.from("users").select("id, username, email, avatar_url").in("id", trimmed);
  (data ?? []).forEach((row: UserRow & { id?: string }) => {
    if (row.id) map.set(row.id, row);
  });
  return map;
}

export async function getUserByProviderId(provider: "github" | "linkedin", sub: string): Promise<UserRow | null> {
  if (!supabase) return null;
  const col = provider === "github" ? "github_id" : "linkedin_id";
  const { data } = await supabase.from("users").select("id, username, email, avatar_url").eq(col, sub).maybeSingle();
  return data as UserRow | null;
}
