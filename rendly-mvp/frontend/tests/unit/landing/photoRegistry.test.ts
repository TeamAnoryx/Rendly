import fs from 'fs';
import path from 'path';
import { ABOUT_PHOTOS, LANDING_PHOTOS, faceCrop, type Photo } from '@/components/landing/photos';

const ROOT = path.resolve(__dirname, '../../..');

/** Image paths the hero orbit (components/motion/PovOrbit.tsx) uses. */
function orbitSrcs(): string[] {
  const file = fs.readFileSync(path.join(ROOT, 'components/motion/PovOrbit.tsx'), 'utf8');
  return Array.from(file.matchAll(/['"](\/images\/[^'"]+)['"]/g), (m) => m[1]);
}

const landing: Photo[] = Object.values(LANDING_PHOTOS).flat();
const about: Photo[] = [...ABOUT_PHOTOS.collage, ...ABOUT_PHOTOS.mosaic];

describe('landing photo registry', () => {
  test('every landing photo slot uses a different image', () => {
    const srcs = landing.map((p) => p.src);
    const dupes = srcs.filter((s, i) => srcs.indexOf(s) !== i);
    expect(dupes).toEqual([]);
  });

  test('no image appears in more than one landing section', () => {
    const owner = new Map<string, string>();
    for (const [section, photos] of Object.entries(LANDING_PHOTOS)) {
      for (const p of photos) {
        expect(owner.get(p.src) ?? section).toBe(section);
        owner.set(p.src, section);
      }
    }
  });

  test('no name is reused across the landing', () => {
    const names = landing.map((p) => p.name).filter((n): n is string => Boolean(n));
    expect(new Set(names).size).toBe(names.length);
  });

  test('the orbit images are never reused on the landing or About page', () => {
    const orbit = orbitSrcs();
    expect(orbit.length).toBeGreaterThan(0);
    const used = new Set([...landing, ...about].map((p) => p.src));
    expect(orbit.filter((s) => used.has(s))).toEqual([]);
  });

  test('the About page shares no image with the landing', () => {
    const landingSrcs = new Set(landing.map((p) => p.src));
    expect(about.filter((p) => landingSrcs.has(p.src)).map((p) => p.src)).toEqual([]);
  });

  test('every referenced file exists in public/', () => {
    const missing = [...landing, ...about].filter((p) => !fs.existsSync(path.join(ROOT, 'public', p.src)));
    expect(missing.map((p) => p.src)).toEqual([]);
  });
});

describe('faceCrop', () => {
  const cases: Array<[number, number]> = [
    [1, 1.5],
    [16 / 11, 1.76],
    [3 / 4, 1.9],
    [4 / 3, 1.11],
  ];

  test.each(cases)('covers a %f box for a %f image', (box, ratio) => {
    for (const face of [
      { x: 0.05, y: 0.05, w: 0.2 },
      { x: 0.5, y: 0.4, w: 0.3 },
      { x: 0.95, y: 0.9, w: 0.6 },
    ]) {
      const c = faceCrop(face, ratio, box);
      const heightPct = (c.width / ratio) * box; // image height as % of box height
      expect(c.left).toBeLessThanOrEqual(0);
      expect(c.top).toBeLessThanOrEqual(1e-9);
      expect(c.left + c.width).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(c.top + heightPct).toBeGreaterThanOrEqual(100 - 1e-9);
    }
  });

  test('centres the face when there is room', () => {
    const c = faceCrop({ x: 0.5, y: 0.5, w: 0.25 }, 1.5, 1);
    expect(c.width).toBeCloseTo(400);
    expect(c.left).toBeCloseTo(-150);
  });
});
