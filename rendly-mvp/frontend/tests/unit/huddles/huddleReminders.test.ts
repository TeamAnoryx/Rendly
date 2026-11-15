import { addReminder, hasReminder, huddleJoinHref, listReminders, removeReminder } from '@/lib/huddleReminders';
import { startLabel } from '@/components/notifications/HuddleWaitingCard';

describe('huddle reminders', () => {
  beforeEach(() => window.localStorage.clear());

  test('adds, lists and removes a reminder without duplicates', () => {
    const ref = { id: 'h1', title: 'Demo', scheduled_at: null };
    addReminder(ref);
    addReminder(ref);
    expect(listReminders()).toEqual([ref]);
    expect(hasReminder('h1')).toBe(true);
    removeReminder('h1');
    expect(hasReminder('h1')).toBe(false);
  });

  test('returns no reminders on fresh storage', () => {
    expect(listReminders()).toEqual([]);
  });

  test('ignores corrupt storage', () => {
    window.localStorage.setItem('rendly_huddle_reminders', '{bad');
    expect(listReminders()).toEqual([]);
  });

  test('join link points at the huddle page', () => {
    expect(huddleJoinHref('abc')).toBe('/dashboard/huddles/abc');
  });
});

describe('startLabel', () => {
  const now = Date.parse('2026-11-15T10:00:00Z');

  test('counts down within the hour', () => {
    expect(startLabel('2026-11-15T10:04:10Z', now)).toBe('Starts in 4m 10s');
    expect(startLabel('2026-11-15T10:00:30Z', now)).toBe('Starts in 30s');
  });

  test('reports a start that has passed or is unknown', () => {
    expect(startLabel('2026-11-15T09:59:00Z', now)).toBe('Starting now');
    expect(startLabel(null, now)).toBe('Starts when the host lets you in');
  });

  test('a start exactly now is starting now', () => {
    expect(startLabel('2026-11-15T10:00:00Z', now)).toBe('Starting now');
  });

  test('switches from countdown to a clock time at one hour', () => {
    expect(startLabel('2026-11-15T10:59:59Z', now)).toBe('Starts in 59m 59s');
    expect(startLabel('2026-11-15T11:00:00Z', now)).not.toMatch(/^Starts in/);
  });
});
