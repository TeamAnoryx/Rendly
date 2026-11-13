import {
  addIntent,
  hashtagLabel,
  isSelected,
  MAX_SPARK_INTENTS,
  selectedPrice,
  toggleIntent,
  validateLocationName,
  type SelectedIntent,
} from '@/components/spark/setupUtils';

const preset = (name: string): SelectedIntent => ({ name, source: 'preset' });

describe('toggleIntent', () => {
  test('adds an intent without mutating the original list', () => {
    const list: SelectedIntent[] = [];
    const { next, limited } = toggleIntent(list, preset('Brainstorm'));
    expect(next).toEqual([preset('Brainstorm')]);
    expect(list).toEqual([]);
    expect(limited).toBe(false);
  });

  test('removes an intent when toggled again, ignoring case', () => {
    const { next } = toggleIntent([preset('Brainstorm')], preset('brainstorm'));
    expect(next).toEqual([]);
  });

  test('refuses a sixth intent and flags the limit', () => {
    const full = Array.from({ length: MAX_SPARK_INTENTS }, (_, i) => preset(`Intent ${i}`));
    const { next, limited } = toggleIntent(full, preset('One more'));
    expect(next).toHaveLength(MAX_SPARK_INTENTS);
    expect(limited).toBe(true);
  });

  test('addIntent never toggles an existing intent off', () => {
    const { next } = addIntent([preset('Motivation')], preset('Motivation'));
    expect(isSelected(next, 'motivation')).toBe(true);
  });
});

describe('labels and prices', () => {
  test('hashtagLabel strips whitespace', () => {
    expect(hashtagLabel('Digital  Marketing')).toBe('#DigitalMarketing');
  });

  test('presets cost 5 per match, other intents 10', () => {
    expect(selectedPrice(preset('Light chat'))).toBe(5);
    expect(selectedPrice({ name: 'Digital Marketing', source: 'hot' })).toBe(10);
  });
});

describe('validateLocationName', () => {
  test('accepts real place names', () => {
    expect(validateLocationName('São Paulo')).toBeNull();
    expect(validateLocationName("St. John's")).toBeNull();
    expect(validateLocationName('Bosnia-Herzegovina')).toBeNull();
  });

  test('rejects too short, too long and symbols', () => {
    expect(validateLocationName('a')).not.toBeNull();
    expect(validateLocationName('x'.repeat(61))).not.toBeNull();
    expect(validateLocationName('Paris<script>')).not.toBeNull();
    expect(validateLocationName('Berlin 2')).not.toBeNull();
    expect(validateLocationName("-- '")).not.toBeNull();
  });
});
