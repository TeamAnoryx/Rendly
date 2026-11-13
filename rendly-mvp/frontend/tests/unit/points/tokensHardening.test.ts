import { intentPrice, intentPriceLabel, isMyIntent, LOCATION_INTENT_PRICE } from '@/services/intentsApi';
import { newIdempotencyKey, TRANSFER_MAX_AMOUNT } from '@/services/pointsApi';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('intentPrice mirrors the server', () => {
  test('location intents cost 20 whatever the source', () => {
    expect(LOCATION_INTENT_PRICE).toBe(20);
    expect(intentPrice({ kind: 'location' }, 'search', false)).toBe(20);
    expect(intentPrice({ kind: 'location' }, 'hot', false)).toBe(20);
  });

  test('custom intents follow the source table', () => {
    expect(intentPrice({ kind: 'custom' }, 'search', false)).toBe(10);
    expect(intentPrice({ kind: 'custom' }, 'nearby', false)).toBe(20);
  });

  test('presets and your own intents are free', () => {
    expect(intentPrice({ kind: 'preset' }, 'hot', false)).toBe(0);
    expect(intentPrice({ kind: 'location' }, 'location', true)).toBe(0);
    expect(intentPriceLabel({ kind: 'custom' }, 'search', true)).toBe('Yours');
  });

  test('ownership comes from the server-computed is_mine flag', () => {
    expect(isMyIntent({ is_mine: true })).toBe(true);
    expect(isMyIntent({ is_mine: false })).toBe(false);
    expect(isMyIntent({})).toBe(false);
  });
});

describe('token send helpers', () => {
  test('the send cap equals the server bound', () => {
    expect(TRANSFER_MAX_AMOUNT).toBe(100_000);
  });

  test('idempotency keys are distinct v4 UUIDs', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });
});
