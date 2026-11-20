/**
 * Public identity of Rendly: canonical URL, the parent Anoryx site and the copy used by
 * metadata, the sitemap, structured data and llms.txt. Override the URLs per environment.
 */

const DEFAULT_SITE_URL = 'https://anoryxtechsolutions.com/rendly.app';
const DEFAULT_ANORYX_URL = 'https://anoryxtechsolutions.com';

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const siteConfig = {
  name: 'Rendly',
  tagline: 'Know your why. Find your who.',
  title: 'Rendly | Intent-based networking: know your why, find your who',
  description:
    'Rendly is intent-based social networking. Say what you are looking for, from co-founders and collaborators to study partners and friends, and meet people who want the same thing through 1:1 Spark video matches, Whispers chat and live group Huddles.',
  url: trimSlash(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL),
  anoryxUrl: trimSlash(process.env.NEXT_PUBLIC_ANORYX_URL || DEFAULT_ANORYX_URL),
  anoryxAboutUrl: `${trimSlash(process.env.NEXT_PUBLIC_ANORYX_URL || DEFAULT_ANORYX_URL)}/about`,
  publisher: 'Anoryx Tech Solutions',
  keywords: [
    'Rendly',
    'intent-based networking',
    'meet people with the same goals',
    'find a co-founder',
    'find collaborators',
    'video matching',
    'group video rooms',
    'breakout rooms',
    'professional networking app',
    'Anoryx',
  ],
} as const;

/** Absolute URL for a path on the Rendly site, e.g. absoluteUrl('/about'). */
export function absoluteUrl(path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return clean === '/' ? siteConfig.url : `${siteConfig.url}${clean}`;
}

export type PublicRoute = { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' };

/** Public, indexable pages. Signed-in areas (dashboard, admin, auth) are never listed. */
export const publicRoutes: ReadonlyArray<PublicRoute> = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/auth/sign-up', priority: 0.6, changeFrequency: 'yearly' },
  { path: '/login', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
];

/** Answers shown to search and answer engines (FAQPage) and mirrored in public/llms.txt. */
export const faqs: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'What is Rendly?',
    a: 'Rendly is an intent-based networking app. You say why you want to meet people, such as finding a co-founder, a collaborator or a study partner, and Rendly connects you with people who share that intent.',
  },
  {
    q: 'How does a Spark match work?',
    a: 'Pick one or more intents and press Spark. Rendly pairs you with someone who shares an intent and opens a 1:1 room with video and chat. You can stay anonymous until you choose to connect.',
  },
  {
    q: 'What are Huddles?',
    a: 'Huddles are live group rooms around a topic. Hosts admit people from a waiting room, split the room into breakout rooms with a leader each, appoint admins and record the session.',
  },
  {
    q: 'Is Rendly free?',
    a: 'Creating a profile and joining Huddles is free. Spark matches use tokens, which you earn by taking part in the community.',
  },
  {
    q: 'Who makes Rendly?',
    a: 'Rendly is built by Anoryx Tech Solutions.',
  },
];
