import { normaliseIntent } from '@/components/huddles/HuddleCreate';

describe('normaliseIntent', () => {
  test('lowercases, drops a leading # and turns spaces into hyphens', () => {
    expect(normaliseIntent('  #Open Source  ')).toBe('open-source');
    expect(normaliseIntent('AI')).toBe('ai');
  });

  test('empty input stays empty', () => {
    expect(normaliseIntent('   ')).toBe('');
  });
});
