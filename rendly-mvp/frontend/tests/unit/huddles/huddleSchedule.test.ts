import { buildScheduledAt } from '@/lib/huddleSchedule';

describe('buildScheduledAt', () => {
  test('builds the time in local time, not UTC midnight', () => {
    // Expected value is built with the local-time constructor, so it holds in any TZ.
    expect(buildScheduledAt('2026-11-02', '10:30')).toBe(new Date(2026, 10, 2, 10, 30).toISOString());
  });

  test('keeps the selected calendar day for a morning time', () => {
    const iso = buildScheduledAt('2026-11-02', '00:15');
    const d = new Date(iso as string);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(2);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(15);
  });

  test('treats the time as 24-hour (13:00 is 1 PM, not 1 AM)', () => {
    const d = new Date(buildScheduledAt('2026-11-02', '13:00') as string);
    expect(d.getHours()).toBe(13);
  });

  test('returns null for missing or malformed parts', () => {
    expect(buildScheduledAt('', '10:00')).toBeNull();
    expect(buildScheduledAt('2026-11-02', '')).toBeNull();
    expect(buildScheduledAt('02/11/2026', '10:00')).toBeNull();
    expect(buildScheduledAt('2026-11-02', '10am')).toBeNull();
    expect(buildScheduledAt('2026-11-02', '24:00')).toBeNull();
  });

  test('rejects dates that roll over', () => {
    expect(buildScheduledAt('2026-02-31', '10:00')).toBeNull();
    expect(buildScheduledAt('2026-13-01', '10:00')).toBeNull();
  });
});
