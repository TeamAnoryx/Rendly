import { columnLayout, gridLayout, recordingFileName } from './useRoomRecorder';

describe('recording layout', () => {
  const area = { x: 0, y: 0, w: 1280, h: 720 };

  test('one person fills the frame', () => {
    expect(gridLayout(1, area, 0)).toEqual([{ x: 0, y: 0, w: 1280, h: 720 }]);
  });

  test('ten people make a 4-column grid that stays inside the frame', () => {
    const cells = gridLayout(10, area, 8);
    expect(cells).toHaveLength(10);
    for (const c of cells) {
      expect(c.x + c.w).toBeLessThanOrEqual(1280.001);
      expect(c.y + c.h).toBeLessThanOrEqual(720.001);
    }
    expect(new Set(cells.map((c) => c.x)).size).toBe(4);
  });

  test('no people, no cells', () => {
    expect(gridLayout(0, area)).toEqual([]);
    expect(columnLayout(0, area)).toEqual([]);
  });

  test('the side strip stacks cells in one column', () => {
    const cells = columnLayout(3, { x: 1000, y: 0, w: 280, h: 720 }, 0);
    expect(cells.map((c) => c.y)).toEqual([0, 240, 480]);
    expect(cells.every((c) => c.x === 1000 && c.w === 280)).toBe(true);
  });
});

describe('recordingFileName', () => {
  test('slugs the title and stamps the time', () => {
    const name = recordingFileName('Friday Jam: AI & Music!', 'room-2', new Date('2026-11-15T10:05:00.000Z'));
    expect(name).toBe('rendly-friday-jam-ai-music-room-2-2026-11-15T10-05.webm');
  });

  test('falls back to "huddle" for an empty title', () => {
    expect(recordingFileName('!!!', 'main', new Date('2026-11-15T10:05:00.000Z'))).toBe('rendly-huddle-main-2026-11-15T10-05.webm');
  });
});
