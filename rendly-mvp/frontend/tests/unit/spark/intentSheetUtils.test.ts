import {
  SHEET_SEEN_KEY,
  SHEET_SORTS,
  SHEET_TABS,
  countBox,
  hasSeenSheet,
  markSheetSeen,
  tileLabel,
} from '@/components/spark/sheet/sheetUtils';

describe('intent sheet utils', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  test('countBox renders compact usage counts', () => {
    expect(countBox(980)).toBe('980');
    expect(countBox(1200)).toBe('1.2k');
    expect(countBox(2000)).toBe('2k');
    expect(countBox(-3)).toBe('0');
  });

  test('tileLabel turns a name into a hashtag', () => {
    expect(tileLabel('Digital Marketing')).toBe('#DigitalMarketing');
    expect(tileLabel('ai')).toBe('#ai');
  });

  test('hasSeenSheet is false until markSheetSeen is called', () => {
    expect(hasSeenSheet()).toBe(false);
    markSheetSeen();
    expect(hasSeenSheet()).toBe(true);
    expect(window.sessionStorage.getItem(SHEET_SEEN_KEY)).toBe('1');
  });

  test('hasSeenSheet survives a throwing storage', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasSeenSheet()).toBe(false);
    spy.mockRestore();
  });

  test('sorts and tabs expose the contract values', () => {
    expect(SHEET_SORTS.map((s) => s.value)).toEqual(['trending', 'popular', 'most_used']);
    expect(SHEET_TABS.map((t) => t.value)).toEqual(['location', 'nearby', 'hot']);
  });
});
