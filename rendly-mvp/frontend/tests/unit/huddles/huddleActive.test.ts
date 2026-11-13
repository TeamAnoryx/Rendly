import { formatTimeLeft, mapActiveHuddle } from '@/lib/huddleActive';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');

describe('mapActiveHuddle', () => {
  test('maps snake_case API fields to the dashboard shape', () => {
    const out = mapActiveHuddle(
      {
        id: 'h1',
        title: 'Standup',
        max_participants: 10,
        participants_count: 4,
        ends_at: '2026-11-01T12:10:00.000Z',
        canJoin: true,
        thumbnail_url: 'https://cdn.example/h1.jpg',
        mode: 'seminar',
        type: 'private',
        intents: ['Brainstorm', 'Collaborate'],
        is_owner: true,
        is_participant: true,
        waiting_room: true,
      },
      NOW
    );
    expect(out).toEqual({
      id: 'h1',
      topic: 'Standup',
      timeLeftSeconds: 600,
      participantsCount: 4,
      maxParticipants: 10,
      canJoin: true,
      thumbnailUrl: 'https://cdn.example/h1.jpg',
      mode: 'seminar',
      type: 'private',
      intents: ['Brainstorm', 'Collaborate'],
      isOwner: true,
      isParticipant: true,
      waitingRoom: true,
    });
  });

  test('reads participants_count and max_participants, not camelCase fields', () => {
    const out = mapActiveHuddle({ id: 'h2', title: 'x', maxParticipants: 99, participants_count: 2, max_participants: 15 }, NOW);
    expect(out.maxParticipants).toBe(15);
    expect(out.participantsCount).toBe(2);
  });

  test('no timed end gives null time left', () => {
    expect(mapActiveHuddle({ id: 'h3', title: 'Open', ends_at: null }, NOW).timeLeftSeconds).toBeNull();
  });

  test('clamps time left at zero when the end has passed', () => {
    expect(mapActiveHuddle({ id: 'h4', title: 'Old', ends_at: '2026-11-01T11:00:00.000Z' }, NOW).timeLeftSeconds).toBe(0);
  });

  test('canJoin falls back to count < max when the API omits it', () => {
    expect(mapActiveHuddle({ id: 'a', title: 't', participants_count: 10, max_participants: 10 }, NOW).canJoin).toBe(false);
    expect(mapActiveHuddle({ id: 'a', title: 't', participants_count: 9, max_participants: 10 }, NOW).canJoin).toBe(true);
  });

  test('missing title becomes Untitled', () => {
    expect(mapActiveHuddle({ id: 'a' }, NOW).topic).toBe('Untitled');
  });

  test('defaults the new fields when the API omits them', () => {
    const out = mapActiveHuddle({ id: 'a', title: 't' }, NOW);
    expect(out.thumbnailUrl).toBeNull();
    expect(out.mode).toBeNull();
    expect(out.type).toBeNull();
    expect(out.intents).toEqual([]);
    expect(out.isOwner).toBe(false);
    expect(out.isParticipant).toBe(false);
    expect(out.waitingRoom).toBe(false);
  });

  test('rejects unknown mode and type values and non-string intents', () => {
    const out = mapActiveHuddle(
      { id: 'a', title: 't', mode: 'party', type: 'secret', intents: ['ok', 42, '', null], thumbnail_url: '' },
      NOW
    );
    expect(out.mode).toBeNull();
    expect(out.type).toBeNull();
    expect(out.intents).toEqual(['ok']);
    expect(out.thumbnailUrl).toBeNull();
  });

  test('treats non-boolean flags as false', () => {
    const out = mapActiveHuddle({ id: 'a', title: 't', is_owner: 'yes', is_participant: 1, waiting_room: 'true' }, NOW);
    expect(out.isOwner).toBe(false);
    expect(out.isParticipant).toBe(false);
    expect(out.waitingRoom).toBe(false);
  });
});

describe('formatTimeLeft', () => {
  test('formats minutes and seconds', () => {
    expect(formatTimeLeft(585)).toBe('09:45 left');
  });
  test('null means no time limit, zero means ended', () => {
    expect(formatTimeLeft(null)).toBe('No time limit');
    expect(formatTimeLeft(0)).toBe('Ended');
  });
});
