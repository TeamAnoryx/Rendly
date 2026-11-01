import { planToasts, TOAST_BURST_LIMIT } from '@/lib/notificationDiff';
import { notificationHref } from '@/services/notificationsApi';
import type { AppNotification } from '@/services/notificationsApi';

function n(id: string, read = false, extra: Partial<AppNotification> = {}): AppNotification {
  return { id, type: 'message', title: 't', body: null, payload: {}, read, created_at: new Date().toISOString(), ...extra };
}

describe('planToasts', () => {
  it('shows nothing when everything is read on first load', () => {
    expect(planToasts(null, [n('a', true)])).toEqual({ kind: 'none' });
  });

  it('pops up each leftover unread item on first load when there are few', () => {
    const plan = planToasts(null, [n('a'), n('b', true)]);
    expect(plan.kind).toBe('each');
    if (plan.kind === 'each') expect(plan.items.map((x) => x.id)).toEqual(['a']);
  });

  it('summarises a large backlog from an earlier day', () => {
    const list = Array.from({ length: TOAST_BURST_LIMIT + 2 }, (_, i) => n(`x${i}`));
    expect(planToasts(null, list)).toEqual({ kind: 'summary', count: TOAST_BURST_LIMIT + 2 });
  });

  it('pops up only items not seen before', () => {
    const plan = planToasts(new Set(['a']), [n('a'), n('b')]);
    expect(plan.kind).toBe('each');
    if (plan.kind === 'each') expect(plan.items.map((x) => x.id)).toEqual(['b']);
  });

  it('ignores new items that are already read', () => {
    expect(planToasts(new Set(), [n('a', true)])).toEqual({ kind: 'none' });
  });
});

describe('notificationHref', () => {
  it('routes messages to the conversation', () => {
    expect(notificationHref(n('a', false, { payload: { conversation_id: 'c1' } }))).toBe('/dashboard/chat?conv=c1');
  });
  it('routes huddle events to the huddle', () => {
    expect(notificationHref(n('a', false, { type: 'breakout', payload: { huddle_id: 'h1' } }))).toBe('/dashboard/huddles/h1');
  });
  it('stays put for welcome', () => {
    expect(notificationHref(n('a', false, { type: 'welcome' }))).toBeNull();
  });
});
