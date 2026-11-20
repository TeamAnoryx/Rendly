/**
 * The permanent "Rendly Team" Whisper (see the 20261123_admin_console migration). Every user's
 * conversation list starts with it, and what users write to it lands in the admin console's
 * query inbox (contact_requests, source "whispers").
 */
import { supabase } from "./supabase-users";

export const RENDLY_TEAM_USER_ID = (process.env.RENDLY_TEAM_USER_ID || "f0f0f0f0-0000-4000-8000-000000000001").trim();
export const RENDLY_TEAM_NAME = "Rendly Team";

export function isRendlyTeam(userId: string | null | undefined): boolean {
  return !!userId && userId === RENDLY_TEAM_USER_ID;
}

/** Partner ids with the Rendly Team first, exactly once (never for the team account itself). */
export function withTeamFirst(userId: string, partnerIds: string[]): string[] {
  if (isRendlyTeam(userId)) return partnerIds;
  return [RENDLY_TEAM_USER_ID, ...partnerIds.filter((id) => !isRendlyTeam(id))];
}

/** Store a user's message to the Rendly Team as an admin query. Never throws. */
export async function recordTeamQuery(user: { userId: string; username: string | null }, message: string): Promise<void> {
  if (!supabase || isRendlyTeam(user.userId) || !message.trim()) return;
  try {
    const { data: row } = await supabase.from("users").select("email").eq("id", user.userId).maybeSingle();
    const email = (row as { email?: string | null } | null)?.email ?? "";
    const { error } = await supabase.from("contact_requests").insert({
      user_id: user.userId,
      name: user.username ? `@${user.username}` : "Rendly user",
      email,
      message: message.slice(0, 5000),
      category: "query",
      source: "whispers",
    });
    if (error) console.error("[team] query insert failed:", error.message);
  } catch (err) {
    console.error("[team] query insert failed:", err instanceof Error ? err.message : String(err));
  }
}
