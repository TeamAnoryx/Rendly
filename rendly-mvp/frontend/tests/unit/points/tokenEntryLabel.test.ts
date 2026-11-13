import {
  HUDDLE_SEND_PURPOSES,
  HUDDLE_SEND_PURPOSE_LABELS,
  POINTS_CHANGED_EVENT,
  emitPointsChanged,
  pointsReasonLabel,
  tokenEntryLabel,
  type PointsEntry,
} from '@/services/pointsApi';
import { notificationHref, notificationIcon } from '@/services/notificationsApi';

function entry(extra: Partial<PointsEntry>): PointsEntry {
  return { amount: 10, reason: 'transfer', note: null, huddle_id: null, created_at: '2026-01-01T00:00:00Z', ...extra };
}

describe('tokenEntryLabel', () => {
  it('labels the signup bonus by category or legacy reason', () => {
    expect(tokenEntryLabel(entry({ amount: 500, reason: 'signup_bonus', category: 'signup' }))).toBe('Signup bonus');
    expect(tokenEntryLabel(entry({ amount: 500, reason: 'signup_bonus' }))).toBe('Signup bonus');
  });

  it('labels transfers by direction and counterparty', () => {
    expect(tokenEntryLabel(entry({ amount: -20, category: 'transfer', counterparty_username: 'ana' }))).toBe('Sent to @ana');
    expect(tokenEntryLabel(entry({ amount: 20, category: 'transfer', counterparty_username: '@ana' }))).toBe('Received from @ana');
  });

  it('falls back when the counterparty name is missing', () => {
    expect(tokenEntryLabel(entry({ amount: -20, category: 'transfer' }))).toBe('Sent');
    expect(tokenEntryLabel(entry({ amount: 20, category: 'transfer', counterparty_username: '  ' }))).toBe('Received');
    expect(tokenEntryLabel(entry({ amount: 5, reason: 'huddle_award', category: 'huddle_award' }))).toBe('Huddle award');
  });

  it('labels huddle awards with the host', () => {
    expect(tokenEntryLabel(entry({ amount: 5, reason: 'huddle_award', category: 'huddle_award', counterparty_username: 'host' }))).toBe(
      'Huddle award from @host'
    );
  });

  it('labels huddle sends with the purpose and direction', () => {
    expect(
      tokenEntryLabel(entry({ amount: -50, reason: 'huddle_send', category: 'huddle_send', purpose: 'best_answer', counterparty_username: 'ana' }))
    ).toBe('Huddle send · Best answer (to @ana)');
    expect(
      tokenEntryLabel(entry({ amount: 50, reason: 'huddle_send', category: 'huddle_send', purpose: 'winner', counterparty_username: 'host' }))
    ).toBe('Huddle send · Winner (from @host)');
    expect(tokenEntryLabel(entry({ amount: 50, reason: 'huddle_send', category: 'huddle_send', purpose: 'nonsense' }))).toBe('Huddle send · Other');
  });

  it('labels intent purchases and royalties with the intent name', () => {
    expect(tokenEntryLabel(entry({ amount: -10, reason: 'intent_purchase', category: 'intent_purchase', intent_name: 'Chess' }))).toBe(
      'Intent purchase · Chess'
    );
    expect(tokenEntryLabel(entry({ amount: -10, reason: 'intent_purchase', category: 'intent_purchase' }))).toBe('Intent purchase');
    expect(tokenEntryLabel(entry({ amount: 10, reason: 'intent_royalty', category: 'intent_royalty', intent_name: 'Chess' }))).toBe('Royalty · Chess');
    expect(tokenEntryLabel(entry({ amount: 10, reason: 'intent_royalty', category: 'intent_royalty' }))).toBe('Royalty');
  });

  it('falls back to the raw reason for unknown kinds', () => {
    expect(tokenEntryLabel(entry({ reason: 'mystery', category: null }))).toBe('mystery');
    expect(tokenEntryLabel(entry({ reason: '', category: null }))).toBe('Rendly Tokens');
  });

  it('keeps the legacy reason-only helper working', () => {
    expect(pointsReasonLabel('signup_bonus')).toBe('Signup bonus');
    expect(pointsReasonLabel('huddle_award')).toBe('Huddle award');
  });
});

describe('huddle send purposes', () => {
  it('has a label for every purpose', () => {
    expect(HUDDLE_SEND_PURPOSES).toEqual(['winner', 'best_answer', 'participation', 'speaker_thanks', 'bounty', 'other']);
    for (const p of HUDDLE_SEND_PURPOSES) expect(HUDDLE_SEND_PURPOSE_LABELS[p]).toBeTruthy();
    expect(HUDDLE_SEND_PURPOSE_LABELS.speaker_thanks).toBe('Speaker thanks');
  });
});

describe('emitPointsChanged', () => {
  it('dispatches the points-changed event on window', () => {
    const handler = jest.fn();
    window.addEventListener(POINTS_CHANGED_EVENT, handler);
    emitPointsChanged();
    window.removeEventListener(POINTS_CHANGED_EVENT, handler);
    expect(POINTS_CHANGED_EVENT).toBe('rendly:points-changed');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('tokens_received notification', () => {
  const base = { id: 'n1', type: 'tokens_received', title: 't', body: null, read: false, created_at: '2026-01-01T00:00:00Z' };

  it('opens the whisper when a conversation is attached, else the profile', () => {
    expect(notificationHref({ ...base, payload: { conversation_id: 'c1' } })).toBe('/dashboard/chat?conv=c1');
    expect(notificationHref({ ...base, payload: {} })).toBe('/dashboard/profile');
    expect(notificationIcon('tokens_received')).toBe('coin');
  });
});
