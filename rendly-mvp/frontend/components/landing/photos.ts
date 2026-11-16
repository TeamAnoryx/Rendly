import { withBasePath } from '@/lib/basePath';
/**
 * Photo registry for the marketing pages.
 *
 * Every photo slot on the landing page has its own entry, and no image (or
 * name) is used by more than one entry, so no face repeats as you scroll.
 * The About page has a separate registry that shares nothing with the
 * landing. The hero orbit (components/motion/PovOrbit.tsx) owns pov21, 22,
 * 23, 24, 26, 28 and 29; none of those appear here.
 * tests/unit/landing/photoRegistry.test.ts enforces all of this.
 */

/** A face position inside a photo, as fractions of the image (0 to 1). */
export interface FaceCrop {
  /** Horizontal centre of the face. */
  x: number;
  /** Vertical centre of the face. */
  y: number;
  /** Width of the visible window, as a fraction of the image width. */
  w: number;
}

export interface Photo {
  /** Display name shown in the mock UI; omitted for ambient, unnamed photos. */
  name?: string;
  initials?: string;
  src: string;
  /** Natural width / height of the file, used by face crops. */
  ratio: number;
  /** object-position for cover-fitted tiles ("x% y%"). */
  focus: string;
  /** Tight crop on one face, for avatars and single-person tiles. */
  face?: FaceCrop;
  /** Alt text when the photo is not labelled by a visible name. */
  alt?: string;
}

const img = (file: string) => withBasePath(`/images/${file}`);

/* ---------------- Landing ---------------- */

export const HERO_PHOTOS = {
  live: { name: 'Maya R.', initials: 'MR', src: img('pov18.jpg'), ratio: 612 / 408, focus: '50% 34%' },
  you: { name: 'You', initials: 'YO', src: img('pov16.jpg'), ratio: 547 / 365, focus: '58% 30%' },
} as const satisfies Record<string, Photo>;

export const FEATURES_PHOTOS = {
  /** Spark card avatar: the woman on the left of a three-person shot. */
  spark: {
    name: 'Mei L.',
    initials: 'ML',
    src: img('pov9.jpg'),
    ratio: 612 / 408,
    focus: '31% 36%',
    face: { x: 0.31, y: 0.37, w: 0.17 },
  },
  /** Huddles card, "Founders circle". */
  circle: [
    { name: 'Ana K.', initials: 'AK', src: img('pov3.jpg'), ratio: 612 / 408, focus: '52% 28%' },
    { name: 'Sam L.', initials: 'SL', src: img('pov2.jpg'), ratio: 1244 / 700, focus: '44% 24%' },
    { name: 'Dev V.', initials: 'DV', src: img('pov10.jpg'), ratio: 540 / 360, focus: '62% 28%' },
    { name: 'Clara M.', initials: 'CM', src: img('pov7.jpg'), ratio: 612 / 408, focus: '50% 30%' },
    { name: 'Amara O.', initials: 'AO', src: img('pov5.jpg'), ratio: 768 / 432, focus: '48% 26%' },
    { name: 'Jonah T.', initials: 'JT', src: img('pov14.jpg'), ratio: 540 / 360, focus: '46% 30%' },
  ],
} as const satisfies { spark: Photo; circle: ReadonlyArray<Photo> };

/** Huddles band: one person per tile. */
export const HUDDLE_PHOTOS = [
  { name: 'Carlos M.', initials: 'CM', src: img('pov4.jpg'), ratio: 612 / 344, focus: '50% 24%' },
  { name: 'Martin K.', initials: 'MK', src: img('pov6.jpg'), ratio: 1000 / 667, focus: '56% 26%' },
  { name: 'Leo B.', initials: 'LB', src: img('pov1.jpg'), ratio: 1244 / 700, focus: '38% 24%' },
  { name: 'Theo W.', initials: 'TW', src: img('pov20.jpg'), ratio: 554 / 554, focus: '50% 30%' },
  { name: 'Daniel R.', initials: 'DR', src: img('pov15.jpg'), ratio: 678 / 452, focus: '60% 30%' },
  {
    name: 'Nia B.',
    initials: 'NB',
    src: img('pov11.jpg'),
    ratio: 592 / 337,
    focus: '50% 38%',
    face: { x: 0.53, y: 0.42, w: 0.5 },
  },
] as const satisfies ReadonlyArray<Photo>;

/** Whispers band: two tight face crops. */
export const WHISPERS_PHOTOS = {
  lena: {
    name: 'Lena V.',
    initials: 'LV',
    src: img('pov8.jpg'),
    ratio: 612 / 408,
    focus: '53% 36%',
    face: { x: 0.53, y: 0.37, w: 0.17 },
  },
  imani: {
    name: 'Imani J.',
    initials: 'IJ',
    src: img('pov12.jpg'),
    ratio: 678 / 452,
    focus: '36% 37%',
    face: { x: 0.36, y: 0.38, w: 0.17 },
  },
} as const satisfies Record<string, Photo>;

/**
 * "From why to hello" launch film. Elena and Marco are the matched pair; the
 * two crew photos are group selfies whose separate faces fill the matching
 * radar and the huddle grid (components/landing/film/cast.ts), one face per
 * slot, so nobody appears twice.
 */
export const FILM_PHOTOS = {
  elena: {
    name: 'Elena V.',
    initials: 'EV',
    src: img('pov18.avif'),
    ratio: 626 / 564,
    focus: '58% 32%',
    face: { x: 0.58, y: 0.33, w: 0.34 },
  },
  marco: {
    name: 'Marco D.',
    initials: 'MD',
    src: img('pov27.avif'),
    ratio: 740 / 493,
    focus: '54% 27%',
    face: { x: 0.535, y: 0.27, w: 0.26 },
  },
} as const satisfies Record<string, Photo>;

/** Every landing photo slot, grouped by section. */
export const LANDING_PHOTOS: Readonly<Record<string, ReadonlyArray<Photo>>> = {
  hero: Object.values(HERO_PHOTOS),
  features: [FEATURES_PHOTOS.spark, ...FEATURES_PHOTOS.circle],
  huddles: HUDDLE_PHOTOS,
  whispers: Object.values(WHISPERS_PHOTOS),
  film: Object.values(FILM_PHOTOS),
};

/* ---------------- About page ---------------- */

export const ABOUT_PHOTOS = {
  collage: [
    {
      name: 'Rosa P.',
      initials: 'RP',
      src: img('pov19.avif'),
      ratio: 740 / 390,
      focus: '38% 34%',
      face: { x: 0.38, y: 0.37, w: 0.17 },
    },
    {
      name: 'Nadia A.',
      initials: 'NA',
      src: img('pov25.avif'),
      ratio: 6000 / 4169,
      focus: '60% 28%',
      face: { x: 0.6, y: 0.3, w: 0.22 },
    },
    {
      name: 'Yasmin H.',
      initials: 'YH',
      src: img('pov30.avif'),
      ratio: 3000 / 2000,
      focus: '62% 44%',
      face: { x: 0.62, y: 0.44, w: 0.15 },
    },
    {
      name: 'Tara J.',
      initials: 'TJ',
      src: img('pov19.avif'),
      ratio: 740 / 390,
      focus: '53% 38%',
      face: { x: 0.53, y: 0.4, w: 0.16 },
    },
    {
      name: 'Ben C.',
      initials: 'BC',
      src: img('pov30.avif'),
      ratio: 3000 / 2000,
      focus: '50% 28%',
      face: { x: 0.5, y: 0.31, w: 0.24 },
    },
  ],
  mosaic: [
    { src: img('pov25.avif'), ratio: 6000 / 4169, focus: '55% 45%', alt: 'A team talking through ideas in a bright studio' },
    { src: img('pov30.avif'), ratio: 3000 / 2000, focus: '50% 45%', alt: 'Five colleagues working around a meeting table' },
    { src: img('pov19.avif'), ratio: 740 / 390, focus: '50% 40%', alt: 'A group of friends taking a selfie together' },
  ],
} as const satisfies { collage: ReadonlyArray<Photo>; mosaic: ReadonlyArray<Photo> };

/* ---------------- Face crop maths ---------------- */

export interface CropBox {
  /** Image width as a % of the box width. */
  width: number;
  /** Image left edge as a % of the box width. */
  left: number;
  /** Image top edge as a % of the box height. */
  top: number;
}

/**
 * Places an image inside a box of the given aspect (width / height) so the
 * face sits as close to the centre as possible while the image still covers
 * the whole box (no empty edges).
 */
export function faceCrop(face: FaceCrop, imageRatio: number, boxAspect: number): CropBox {
  const boxH = 1 / boxAspect; // in box widths
  // Image size in box widths; grow until it covers the box vertically.
  const imgW = Math.max(1 / face.w, 1, imageRatio * boxH);
  const imgH = imgW / imageRatio;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const left = clamp(0.5 - face.x * imgW, 1 - imgW, 0);
  const top = clamp(boxH / 2 - face.y * imgH, boxH - imgH, 0);
  return { width: imgW * 100, left: left * 100, top: (top / boxH) * 100 };
}
