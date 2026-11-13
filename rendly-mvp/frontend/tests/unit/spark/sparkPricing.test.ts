import {
  SPARK_PRESETS,
  SPARK_PRESET_INTENTS,
  SPARK_PRICE_OTHER,
  SPARK_PRICE_PRESET,
  sparkIntentPrice,
  sparkMatchCost,
} from '@/services/sparkApi';

describe('Spark pricing helpers', () => {
  test('presets and alias export are the four built-in intents', () => {
    expect(SPARK_PRESETS).toEqual(['Light chat', 'Brainstorm', 'Motivation', 'Collaborate']);
    expect(SPARK_PRESET_INTENTS).toBe(SPARK_PRESETS);
    expect(SPARK_PRICE_PRESET).toBe(5);
    expect(SPARK_PRICE_OTHER).toBe(10);
  });

  test('preset intents cost 5 regardless of case or padding', () => {
    expect(sparkIntentPrice('Brainstorm')).toBe(5);
    expect(sparkIntentPrice('light CHAT')).toBe(5);
    expect(sparkIntentPrice('  motivation ')).toBe(5);
  });

  test('any other intent costs 10', () => {
    expect(sparkIntentPrice('Rock climbing')).toBe(10);
    expect(sparkIntentPrice('Brainstorming')).toBe(10);
  });

  test('match cost sums each distinct intent', () => {
    expect(sparkMatchCost([])).toBe(0);
    expect(sparkMatchCost(['Brainstorm'])).toBe(5);
    expect(sparkMatchCost(['Brainstorm', 'Collaborate', 'Chess'])).toBe(20);
  });

  test('match cost counts case-insensitive duplicates and blanks once / not at all', () => {
    expect(sparkMatchCost(['Chess', 'chess', 'CHESS'])).toBe(10);
    expect(sparkMatchCost(['brainstorm', 'Brainstorm', '  '])).toBe(5);
  });
});
