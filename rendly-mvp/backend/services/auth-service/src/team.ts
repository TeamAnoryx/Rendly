/**
 * The "Rendly Team" account every user has a permanent Whisper with (see the
 * 20261123_admin_console migration). Its messages are sent through chat-service's normal
 * message endpoint, signed as the team account, so they are stored, pushed live and notified
 * like any other Whisper.
 */
import jwt from "jsonwebtoken";

export const RENDLY_TEAM_USER_ID = (process.env.RENDLY_TEAM_USER_ID || "f0f0f0f0-0000-4000-8000-000000000001").trim();
const SEND_TIMEOUT_MS = 10_000;

export const WELCOME_MESSAGE =
  "Welcome to Rendly! 👋 This is your direct line to the Rendly Team. We'll share updates here, and you can message us any time with questions or feedback. Tip: add your intents on your profile, then try Spark to meet someone who wants the same thing.";

export function chatServiceUrl(): string {
  const explicit = (process.env.CHAT_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  return `http://127.0.0.1:${process.env.CHAT_SERVICE_PORT || 4002}`;
}

export function teamConversationId(userId: string): string {
  const [a, b] = [userId, RENDLY_TEAM_USER_ID].sort();
  return `whisper_${a}_${b}`;
}

/** Send a Whisper from the Rendly Team to a user. Returns false (and logs) on failure; never throws. */
export async function sendTeamMessage(toUserId: string, text: string): Promise<boolean> {
  if (!toUserId || toUserId === RENDLY_TEAM_USER_ID || !text.trim()) return false;
  const secret = process.env.JWT_SECRET || "dev-secret-change-in-production";
  const token = jwt.sign({ sub: RENDLY_TEAM_USER_ID, provider: "password" }, secret, { expiresIn: "5m" });
  try {
    const res = await fetch(`${chatServiceUrl()}/api/conversations/${teamConversationId(toUserId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 5000), content_type: "text" }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[team] message to ${toUserId} failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[team] message to ${toUserId} failed:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Welcome a new user in their Rendly Team chat. Fire and forget from sign-up paths. */
export function sendWelcomeMessage(userId: string): void {
  void sendTeamMessage(userId, WELCOME_MESSAGE);
}
