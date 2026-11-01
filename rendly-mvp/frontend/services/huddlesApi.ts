import { authFetch } from '@/lib/api';

export type HuddleType = 'public' | 'private' | 'instant';

export type HuddleListItem = {
  id: string;
  title: string;
  description: string | null;
  max_participants: number;
  type: HuddleType;
  is_active: boolean;
  scheduled_at: string | null;
  duration_minutes: number | null;
  /** Only present for the huddle's creator. */
  invite_code?: string | null;
  created_at: string;
  participants_count: number;
  is_owner: boolean;
  mode?: HuddleMode;
  waiting_room?: boolean;
  intents?: string[];
  media_url?: string | null;
  media_type?: 'image' | 'video' | 'audio' | null;
};

export type HuddleMode = 'open' | 'seminar' | 'hackathon' | 'launch';

export const HUDDLE_MODE_LABELS: Record<HuddleMode, string> = {
  open: 'Open',
  seminar: 'Seminar',
  hackathon: 'Hackathon',
  launch: 'App launch',
};

export type HuddlesListResponse = {
  trendy: HuddleListItem[];
  live: HuddleListItem[];
};

export type HuddleDetail = HuddleListItem & {
  invite_url: string;
  is_participant: boolean;
  is_waiting: boolean;
  your_role: 'host' | 'co_host' | 'participant' | null;
  your_permissions: { can_speak: boolean; can_share_screen: boolean; is_muted: boolean } | null;
  started_at: string | null;
  ended_at: string | null;
};

export type HuddleMember = {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  role: 'host' | 'co_host' | 'participant';
  admitted: boolean;
  can_speak: boolean;
  can_share_screen: boolean;
  is_muted: boolean;
  joined_at: string;
};

export type CreateHuddlePayload = {
  title: string;
  description?: string | null;
  max_participants: 10 | 15 | 20 | 50;
  type?: HuddleType;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  settings?: Record<string, string | number | boolean | null>;
  mode?: HuddleMode;
  waiting_room?: boolean;
  intents?: string[];
  invitee_ids?: string[];
};

export type CreateHuddleResponse = HuddleListItem & {
  invite_url: string;
};

export type JoinHuddleResponse =
  | { status: 'joined'; huddle_id: string; user_id: string; joined_at: string }
  | { status: 'waiting'; huddle_id: string; message: string };
export type LeaveHuddleResponse = { huddle_id: string; user_id: string; left_at: string };

/** Parse a JSON body without throwing on empty or non-JSON responses (proxy errors, HTML pages). */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Return the parsed body, or throw the server's message (or the fallback) when the request failed. */
async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const data = await readJson(res);
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    throw new Error(typeof message === 'string' && message ? message : fallback);
  }
  return data as T;
}

/** Private huddle links carry ?code=; pass it on so the server can grant access. */
function withInviteCode(path: string, inviteCode?: string | null): string {
  return inviteCode ? `${path}?code=${encodeURIComponent(inviteCode)}` : path;
}

export async function listHuddles(
  category: 'trendy' | 'live' | 'all' = 'all',
  intent: string | null = null
): Promise<HuddlesListResponse> {
  const params = new URLSearchParams({ category });
  if (intent) params.set('intent', intent);
  const res = await authFetch(`/api/huddles?${params.toString()}`);
  const data = await parseOrThrow<Partial<HuddlesListResponse> | null>(res, 'Failed to list huddles');
  return {
    trendy: Array.isArray(data?.trendy) ? data.trendy : [],
    live: Array.isArray(data?.live) ? data.live : [],
  };
}

export async function listActiveHuddles(): Promise<HuddleListItem[]> {
  const res = await authFetch('/api/huddles/active');
  const data = await parseOrThrow<unknown>(res, 'Failed to list active huddles');
  return Array.isArray(data) ? data : [];
}

export async function createHuddle(payload: CreateHuddlePayload): Promise<CreateHuddleResponse> {
  const res = await authFetch('/api/huddles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: payload.title,
      description: payload.description ?? null,
      max_participants: payload.max_participants,
      type: payload.type ?? 'public',
      scheduled_at: payload.scheduled_at ?? null,
      duration_minutes: payload.duration_minutes ?? null,
      settings: payload.settings ?? {},
      mode: payload.mode ?? 'open',
      waiting_room: payload.waiting_room ?? false,
      intents: payload.intents ?? [],
      invitee_ids: payload.invitee_ids ?? [],
    }),
  });
  return parseOrThrow<CreateHuddleResponse>(res, 'Failed to create huddle');
}

export async function getHuddle(id: string, inviteCode?: string | null): Promise<HuddleDetail> {
  const res = await authFetch(withInviteCode(`/api/huddles/${encodeURIComponent(id)}`, inviteCode));
  return parseOrThrow<HuddleDetail>(res, 'Failed to get huddle');
}

export async function joinHuddle(id: string, inviteCode?: string | null): Promise<JoinHuddleResponse> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inviteCode ? { code: inviteCode } : {}),
  });
  return parseOrThrow<JoinHuddleResponse>(res, 'Failed to join huddle');
}

export async function leaveHuddle(id: string): Promise<LeaveHuddleResponse> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseOrThrow<LeaveHuddleResponse>(res, 'Failed to leave huddle');
}

/** Host and co-host tools. */

export async function listHuddleMembers(id: string): Promise<HuddleMember[]> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/members`);
  return parseOrThrow<HuddleMember[]>(res, 'Failed to load members');
}

export async function admitHuddleMember(id: string, userId: string): Promise<void> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/admit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  await parseOrThrow<unknown>(res, 'Failed to admit');
}

export type MemberPatch = Partial<{
  role: 'co_host' | 'participant';
  can_speak: boolean;
  can_share_screen: boolean;
  is_muted: boolean;
}>;

export async function updateHuddleMember(id: string, userId: string, patch: MemberPatch): Promise<void> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await parseOrThrow<unknown>(res, 'Failed to update member');
}

export async function removeHuddleMember(id: string, userId: string): Promise<void> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  await parseOrThrow<unknown>(res, 'Failed to remove member');
}

export async function setHuddleWaitingRoom(id: string, enabled: boolean): Promise<void> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waiting_room: enabled }),
  });
  await parseOrThrow<unknown>(res, 'Failed to update the waiting room');
}

export async function inviteToHuddle(id: string, inviteeIds: string[]): Promise<number> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invitee_ids: inviteeIds }),
  });
  const data = await parseOrThrow<{ invited: number }>(res, 'Failed to send invites');
  return data.invited;
}

/** Promotion media: an image, video or audio file, uploaded by the host. */
export async function uploadHuddleMedia(id: string, file: File): Promise<{ media_type: string; media_url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/media`, { method: 'POST', body: form });
  return parseOrThrow<{ media_type: string; media_url: string }>(res, 'Failed to upload media');
}
