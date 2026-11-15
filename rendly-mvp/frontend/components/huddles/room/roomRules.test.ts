import {
  ADMIN_ROOM,
  MAIN_ROOM,
  ROOM_CAP,
  autoSplit,
  breakoutRoomNames,
  canManageRoom,
  ledRoom,
  matchesPerson,
  planCounts,
  roleLabel,
  roomLabel,
  suggestedRoomCount,
} from './roomRules';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

describe('roomRules', () => {
  test('labels rooms and roles', () => {
    expect(roomLabel(MAIN_ROOM)).toBe('Main room');
    expect(roomLabel(ADMIN_ROOM)).toBe('Admin room');
    expect(roomLabel('room-2')).toBe('room-2');
    expect(roleLabel('co_host')).toBe('Admin');
    expect(roleLabel(undefined)).toBe('Participant');
  });

  test('finds the room an admin leads', () => {
    expect(ledRoom({ 'room-1': 'a', 'room-2': 'b' }, 'b')).toBe('room-2');
    expect(ledRoom({}, 'b')).toBeNull();
    expect(ledRoom({ 'room-1': 'a' }, null)).toBeNull();
  });

  test('the host manages every room, an admin only the room they lead', () => {
    const leaders = { 'room-1': 'a' };
    expect(canManageRoom('host', 'h', 'room-3', leaders)).toBe(true);
    expect(canManageRoom('co_host', 'a', 'room-1', leaders)).toBe(true);
    expect(canManageRoom('co_host', 'a', 'room-2', leaders)).toBe(false);
    expect(canManageRoom('participant', 'a', 'room-1', leaders)).toBe(false);
  });

  test('suggests enough rooms for 50 people under the cap', () => {
    expect(suggestedRoomCount(50)).toBe(Math.ceil(50 / ROOM_CAP));
    expect(suggestedRoomCount(3)).toBe(2);
    expect(breakoutRoomNames(3)).toEqual(['room-1', 'room-2', 'room-3']);
    expect(breakoutRoomNames(99)).toHaveLength(10);
  });

  test('splits 50 people into 5 rooms of 10', () => {
    const counts = planCounts(autoSplit(ids(50), breakoutRoomNames(5)));
    expect(counts).toEqual({ 'room-1': 10, 'room-2': 10, 'room-3': 10, 'room-4': 10, 'room-5': 10 });
  });

  test('never passes the cap; overflow stays in the main room', () => {
    const counts = planCounts(autoSplit(ids(30), breakoutRoomNames(2), 12));
    expect(counts).toEqual({ 'room-1': 12, 'room-2': 12, [MAIN_ROOM]: 6 });
  });

  test('matches people by name or @username', () => {
    expect(matchesPerson('ali', 'Alice', 'al1')).toBe(true);
    expect(matchesPerson('@al1', 'Alice', 'al1')).toBe(true);
    expect(matchesPerson('bob', 'Alice', 'al1')).toBe(false);
    expect(matchesPerson('  ', 'Alice', null)).toBe(true);
  });
});
