'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import websocket from '@/services/websocket';
import { cancelHuddle, getHuddle, leaveHuddle, type HuddleDetail } from '@/services/huddlesApi';
import { useNotifications } from '@/context/NotificationsContext';
import { useOngoingNotification } from '@/hooks/useOngoingNotification';
import HuddleHost from '@/components/huddles/HuddleHost';
import HuddleMiniBar from '@/components/huddles/HuddleMiniBar';

/** While inside, check whether the host ended the huddle (backup for the socket event). */
const ENDED_POLL_MS = 5000;

export type HuddleSession = { huddle: HuddleDetail; inviteCode: string | null };

export type HuddleSessionValue = {
  session: HuddleSession | null;
  /** Id of the huddle the user is in, or null. */
  activeId: string | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Enter (or switch to) a huddle. The room keeps running across pages until leave/end. */
  start: (huddle: HuddleDetail, inviteCode?: string | null) => void;
  /** Refresh the huddle details the room shows (title, role...) without rejoining. */
  sync: (huddle: HuddleDetail) => void;
  /** The huddle page's stage element; the room is drawn over it. */
  registerSlot: (el: HTMLElement | null) => void;
  leaveError: string | null;
};

const HuddleSessionContext = React.createContext<HuddleSessionValue | null>(null);

export function useHuddleSession(): HuddleSessionValue {
  const ctx = React.useContext(HuddleSessionContext);
  if (!ctx) throw new Error('useHuddleSession must be used within HuddleSessionProvider');
  return ctx;
}

export const huddlePath = (id: string): string => `/dashboard/huddles/${id}`;

type EndAck = { ok?: boolean };

/**
 * Tell everyone in an already-cancelled huddle that it ended. Resolves true once the server
 * confirms; false when it refused, timed out or the socket is offline.
 */
export async function notifyHuddleEnded(huddleId: string): Promise<boolean> {
  try {
    const res = await websocket.emitWithAck<EndAck>('huddle:end', { huddle_id: huddleId });
    return res?.ok === true;
  } catch {
    return false;
  }
}

export function canLeaveHuddle(h: HuddleDetail): boolean {
  return h.your_role === 'host' || h.your_role === 'co_host' || h.allow_self_exit !== false;
}

/**
 * Owns the active huddle so it survives navigation: the room (socket membership, media, peer
 * connections) stays mounted while the user browses other pages, shown full size on the huddle
 * page and parked off-screen elsewhere with a floating "Ongoing huddle" card. Only Leave, the
 * host's End, or the host ending it for everyone closes it.
 */
export function HuddleSessionProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { pushToast } = useNotifications();
  const [session, setSession] = useState<HuddleSession | null>(null);
  const [paused, setPaused] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const huddle = session?.huddle ?? null;
  const activeId = huddle?.id ?? null;
  const onPage = !!activeId && pathname === huddlePath(activeId);
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;

  const close = useCallback(() => {
    setSession(null);
    setPaused(false);
    setLeaveError(null);
  }, []);

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const start = useCallback((h: HuddleDetail, inviteCode: string | null = null) => {
    setLeaveError(null);
    if (activeIdRef.current !== h.id) setPaused(false);
    setSession((cur) =>
      cur?.huddle.id === h.id ? { huddle: h, inviteCode: inviteCode ?? cur.inviteCode } : { huddle: h, inviteCode },
    );
  }, []);

  const sync = useCallback((h: HuddleDetail) => {
    setSession((cur) => (cur && cur.huddle.id === h.id && cur.huddle !== h ? { ...cur, huddle: h } : cur));
  }, []);

  const leave = useCallback(async () => {
    if (!huddle) return;
    setLeaveError(null);
    try {
      await leaveHuddle(huddle.id);
      close();
    } catch (e) {
      setLeaveError(e instanceof Error ? e.message : 'Could not leave');
    }
  }, [huddle, close]);

  const endForAll = useCallback(async () => {
    if (!huddle || !window.confirm('End this huddle for everyone?')) return;
    setLeaveError(null);
    // Cancel first: if it fails, nobody has been sent away and the huddle stays live.
    try {
      await cancelHuddle(huddle.id);
    } catch (e) {
      setLeaveError(e instanceof Error ? e.message : 'Could not end the huddle');
      return;
    }
    // Then tell connected participants. The server only accepts this for a cancelled huddle.
    // If the room can't be told, participants still leave through the ended poll.
    const told = await notifyHuddleEnded(huddle.id);
    if (!told) pushToast({ icon: 'close', title: 'Huddle ended. Some people may take a moment to leave.' });
    close();
    router.push('/dashboard/huddles');
  }, [huddle, close, router, pushToast]);

  // The host ended the huddle for everyone: leave the room (socket event, or the poll as a backup).
  const isHost = huddle?.your_role === 'host';
  const inviteCode = session?.inviteCode ?? null;
  useEffect(() => {
    if (!activeId || isHost) return undefined;
    let done = false;
    const exitEnded = () => {
      if (done) return;
      done = true;
      close();
      pushToast({ icon: 'close', title: 'The host ended this huddle' });
      if (onPageRef.current) router.push('/dashboard/huddles');
    };
    const off = websocket.on<{ huddle_id?: string }>('huddle:ended', (p) => {
      if (p?.huddle_id === activeId) exitEnded();
    });
    const id = setInterval(() => {
      getHuddle(activeId, inviteCode)
        .then((h) => {
          // ended_at is the scheduled end while live: only a past time means it is over.
          const over = !!h.ended_at && Date.parse(h.ended_at) <= Date.now();
          if (h.cancelled_at || over) exitEnded();
        })
        .catch(() => undefined);
    }, ENDED_POLL_MS);
    return () => {
      done = true;
      off();
      clearInterval(id);
    };
  }, [activeId, isHost, inviteCode, close, pushToast, router]);

  const resume = useCallback(() => {
    setPaused(false);
    if (activeId) router.push(huddlePath(activeId));
  }, [activeId, router]);

  useOngoingNotification(
    huddle ? { title: 'Ongoing huddle', body: `${huddle.title}. Tap to return.`, path: huddlePath(huddle.id) } : null,
    resume,
  );

  const value = useMemo<HuddleSessionValue>(
    () => ({ session, activeId, paused, setPaused, start, sync, registerSlot: setSlot, leaveError }),
    [session, activeId, paused, start, sync, leaveError],
  );

  // Away from the huddle (another page, a hidden tab, a locked phone): freeze my media so the
  // others see me as paused; coming back unfreezes it, unless I paused on purpose.
  const [tabHidden, setTabHidden] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const sync = () => setTabHidden(document.visibilityState === 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  const away = !!huddle && (!onPage || tabHidden);

  return (
    <HuddleSessionContext.Provider value={value}>
      {children}
      {huddle ? (
        <HuddleHost
          key={huddle.id}
          huddle={huddle}
          slot={onPage ? slot : null}
          paused={paused || away}
          onTogglePause={() => setPaused((p) => !p)}
          onLeave={() => void leave()}
          onEnd={isHost ? () => void endForAll() : undefined}
          canLeave={canLeaveHuddle(huddle)}
          error={leaveError}
        />
      ) : null}
      {huddle && !onPage ? <HuddleMiniBar name={huddle.title} paused={paused} onResume={resume} /> : null}
    </HuddleSessionContext.Provider>
  );
}
