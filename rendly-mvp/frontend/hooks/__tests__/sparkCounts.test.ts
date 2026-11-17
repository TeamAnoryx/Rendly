import { combineSparkCounts } from '../useSparkActive';

describe('combineSparkCounts', () => {
  test('counts the other people on the Spark page, not me', () => {
    expect(combineSparkCounts(null, 3)).toBe(2);
  });

  test('never goes below zero when only I am on the page', () => {
    expect(combineSparkCounts(null, 1)).toBe(0);
    expect(combineSparkCounts(null, 0)).toBe(0);
  });

  test('uses the larger of the page count and the queue count', () => {
    expect(combineSparkCounts(5, 3)).toBe(5);
    expect(combineSparkCounts(1, 4)).toBe(3);
  });

  test('is unknown only when both sources are unknown', () => {
    expect(combineSparkCounts(null, null)).toBeNull();
    expect(combineSparkCounts(2, null)).toBe(2);
  });
});
