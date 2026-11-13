import { compactCount } from '@/utils/formatCount';

describe('compactCount', () => {
  test.each([
    [0, '0'],
    [7, '7'],
    [980, '980'],
    [999, '999'],
    [1000, '1k'],
    [1200, '1.2k'],
    [1249, '1.2k'],
    [2000, '2k'],
    [9999, '9.9k'],
    [10_000, '10k'],
    [15_000, '15k'],
    [15_900, '15k'],
    [999_999, '999k'],
    [1_000_000, '1M'],
    [1_400_000, '1.4M'],
    [25_000_000, '25M'],
  ])('formats %p as %p', (input, expected) => {
    expect(compactCount(input)).toBe(expected);
  });

  test('treats negative, fractional and non-finite input safely', () => {
    expect(compactCount(-5)).toBe('0');
    expect(compactCount(Number.NaN)).toBe('0');
    expect(compactCount(Number.POSITIVE_INFINITY)).toBe('0');
    expect(compactCount(12.7)).toBe('12');
  });
});
