'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import SiteShell from '@/components/landing/SiteShell';
import Reveal from '@/components/landing/Reveal';
import { FinalCta } from '@/components/landing/Closing';
import { PersonPhoto, type Photo } from '@/components/landing/people';
import { ABOUT_PHOTOS } from '@/components/landing/photos';
import {
  IconArrowRight,
  IconHuddles,
  IconSpark,
  IconTarget,
  IconWhispers,
} from '@/components/landing/icons';
import './about.css';

interface CollageTile {
  photo: Photo;
  intent: string;
  /** Parallax travel in px over the hero's scroll range (negative = rises). */
  travel: number;
  className: string;
  /** Tile aspect (width / height), matching .ab-tile--* in about.css. */
  aspect: number;
}

const COLLAGE: ReadonlyArray<CollageTile> = [
  { photo: ABOUT_PHOTOS.collage[0], intent: 'Co-founder', travel: -40, className: 'ab-tile--a', aspect: 3 / 4 },
  { photo: ABOUT_PHOTOS.collage[1], intent: 'Co-founder', travel: -90, className: 'ab-tile--b', aspect: 3 / 4 },
  { photo: ABOUT_PHOTOS.collage[2], intent: 'Hiring', travel: -20, className: 'ab-tile--c', aspect: 3 / 4 },
  { photo: ABOUT_PHOTOS.collage[3], intent: 'Collaborating', travel: -70, className: 'ab-tile--d', aspect: 4 / 5 },
  { photo: ABOUT_PHOTOS.collage[4], intent: 'Feedback', travel: -50, className: 'ab-tile--e', aspect: 4 / 3 },
];

const PROBLEMS: ReadonlyArray<{ old: string; copy: string; answer: string }> = [
  {
    old: 'Feeds',
    copy: 'Endless scrolling rewards whoever posts the most, not whoever you actually need to meet.',
    answer: 'Rendly has no feed. You start from what you want.',
  },
  {
    old: 'Follower counts',
    copy: 'Audience size became the measure of a person. It says nothing about why two people should talk.',
    answer: 'No followers, no likes. A shared intent is the only signal.',
  },
  {
    old: 'Random networking',
    copy: 'Events and cold DMs leave the introduction to luck, and most of the hellos go nowhere.',
    answer: 'Every match arrives with a reason already on the table.',
  },
];

const PRODUCTS: ReadonlyArray<{
  name: string;
  tag: string;
  copy: string;
  Icon: (p: { size?: number }) => JSX.Element;
  href: string;
}> = [
  {
    name: 'Spark',
    tag: 'Meet one-to-one',
    copy: 'Choose an intent such as co-founder, mentor or hiring. Spark pairs you with someone who wants the same thing, and video or chat opens right away.',
    Icon: IconSpark,
    href: '/#spark',
  },
  {
    name: 'Whispers',
    tag: 'Keep talking',
    copy: 'Every match and huddle gets a thread. Direct messages and group chats carry the conversation on after the call ends.',
    Icon: IconWhispers,
    href: '/#whispers',
  },
  {
    name: 'Huddles',
    tag: 'Meet as a group',
    copy: 'Scheduled or live video rooms for the conversations that need more than two people in them.',
    Icon: IconHuddles,
    href: '/#huddles',
  },
];

const PRINCIPLES: ReadonlyArray<{ n: string; title: string; copy: string }> = [
  {
    n: '01',
    title: 'Intent before identity',
    copy: 'What you are looking for matters more than how many people follow you. Rendly starts every connection there.',
  },
  {
    n: '02',
    title: 'One real conversation',
    copy: 'We would rather you have one introduction that goes somewhere than fifty that do not.',
  },
  {
    n: '03',
    title: 'Faces, in real time',
    copy: 'Networking is people. Rendly puts you on a call with a person, not in a comment thread with an audience.',
  },
  {
    n: '04',
    title: 'Respect by default',
    copy: 'You choose your intents, who you meet and when to leave. Calm by design, with nothing built to keep you scrolling.',
  },
];

const MOSAIC = ABOUT_PHOTOS.mosaic;

function CollageItem({ tile, progress, still }: { tile: CollageTile; progress: MotionValue<number>; still: boolean }) {
  const y = useTransform(progress, [0, 1], [0, still ? 0 : tile.travel]);
  return (
    <motion.figure className={`ab-tile ${tile.className}`} style={{ y }}>
      <PersonPhoto photo={tile.photo} className="ab-tile-img" cropAspect={tile.aspect} decorative />
      <span className="ab-tile-shade" />
      <figcaption className="ab-tile-cap">
        <span className="ab-tile-name">{tile.photo.name}</span>
        <span className="ab-tile-intent">{tile.intent}</span>
      </figcaption>
    </motion.figure>
  );
}

function Hero() {
  const ref = useRef<HTMLElement | null>(null);
  const still = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });

  return (
    <section ref={ref} className="ab-hero" aria-labelledby="ab-title">
      <div className="ab-hero-glow" aria-hidden="true" />
      <div className="ld-container ab-hero-inner">
        <div className="ab-hero-copy">
          <p className="ld-eyebrow ld-enter">About Rendly</p>
          <h1 id="ab-title" className="ab-title ld-enter" style={{ animationDelay: '60ms' }}>
            Networking, <span className="ab-title-accent">with a reason.</span>
          </h1>
          <p className="ab-lede ld-enter" style={{ animationDelay: '140ms' }}>
            Rendly is intent-based networking. Tell it why you are here, whether that is a co-founder, a mentor,
            a first hire or a collaborator, and it introduces you to someone who wants the same thing. Know your
            why. Find your who.
          </p>
          <div className="ld-hero-ctas ld-enter" style={{ animationDelay: '220ms' }}>
            <Link href="/auth/sign-up" className="rd-btn rd-btn--primary rd-btn--lg">
              Get started
              <IconArrowRight size={15} className="rd-btn-arrow" />
            </Link>
            <Link href="/#product" className="rd-btn rd-btn--lg">
              See the product
            </Link>
          </div>
        </div>
        <div className="ab-collage ld-enter--slow" aria-label="People on Rendly">
          {COLLAGE.map((t) => (
            <CollageItem key={t.className} tile={t} progress={scrollYProgress} still={still} />
          ))}
          <div className="ab-collage-match" aria-hidden="true">
            <IconTarget size={13} />
            Matched on <strong>Co-founder</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="ld-section ld-section--bordered" aria-labelledby="ab-problem-title">
      <div className="ld-container">
        <header className="ld-section-head">
          <Reveal as="p" className="ld-eyebrow">
            The problem
          </Reveal>
          <Reveal as="h2" delay={60} className="ld-h2">
            <span id="ab-problem-title">Online networking forgot why people meet.</span>
          </Reveal>
          <Reveal as="p" delay={120} className="ld-lede">
            The tools we use to meet people were built for audiences. Rendly is built for introductions.
          </Reveal>
        </header>
        <ul className="ab-problems">
          {PROBLEMS.map((p, i) => (
            <Reveal as="li" key={p.old} delay={i * 80} className="ab-problem">
              <span className="ab-problem-old">{p.old}</span>
              <p className="ab-problem-copy">{p.copy}</p>
              <p className="ab-problem-answer">
                <IconArrowRight size={13} />
                {p.answer}
              </p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="ld-section ld-section--bordered" aria-labelledby="ab-how-title">
      <div className="ld-container ab-how">
        <header className="ab-how-head">
          <Reveal as="p" className="ld-eyebrow">
            How Rendly works
          </Reveal>
          <Reveal as="h2" delay={60} className="ld-h2">
            <span id="ab-how-title">Three ways to meet. One reason to.</span>
          </Reveal>
          <Reveal as="p" delay={120} className="ld-lede">
            Pick your intents once. Spark finds the match, Whispers keeps the thread, Huddles brings the group
            together.
          </Reveal>
        </header>
        <ol className="ab-products">
          {PRODUCTS.map(({ name, tag, copy, Icon, href }, i) => (
            <Reveal as="li" key={name} delay={i * 80} className="ab-product">
              <span className="ab-product-icon">
                <Icon size={16} />
              </span>
              <div className="ab-product-body">
                <p className="ab-product-tag rd-mono">{tag}</p>
                <h3 className="ab-product-name">{name}</h3>
                <p className="ab-product-copy">{copy}</p>
              </div>
              <Link href={href} className="ab-product-link" aria-label={`See ${name} on the home page`}>
                <IconArrowRight size={15} />
              </Link>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Principles() {
  return (
    <section className="ld-section ld-section--bordered" aria-labelledby="ab-principles-title">
      <div className="ld-container">
        <header className="ld-section-head">
          <Reveal as="p" className="ld-eyebrow">
            What we believe
          </Reveal>
          <Reveal as="h2" delay={60} className="ld-h2">
            <span id="ab-principles-title">The principles behind Rendly.</span>
          </Reveal>
        </header>
        <ul className="ab-principles">
          {PRINCIPLES.map((p, i) => (
            <Reveal as="li" key={p.n} delay={i * 70} className="ab-principle">
              <span className="ab-principle-n rd-mono">{p.n}</span>
              <h3 className="ab-principle-title">{p.title}</h3>
              <p className="ab-principle-copy">{p.copy}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Mosaic() {
  return (
    <section className="ld-section ld-section--bordered ab-mosaic-section" aria-labelledby="ab-mosaic-title">
      <div className="ld-container">
        <header className="ld-section-head ab-mosaic-head">
          <Reveal as="p" className="ld-eyebrow">
            Who it is for
          </Reveal>
          <Reveal as="h2" delay={60} className="ld-h2">
            <span id="ab-mosaic-title">For anyone who knows who they are looking for.</span>
          </Reveal>
          <Reveal as="p" delay={120} className="ld-lede ld-lede--center">
            Founders and first hires, mentors and students, creators and collaborators. If you can name your why,
            Rendly can help you find your who.
          </Reveal>
        </header>
        <div className="ab-mosaic">
          {MOSAIC.map((m, i) => (
            <Reveal key={m.src} delay={i * 80} className={`ab-mosaic-item ab-mosaic-item--${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- static marketing photo */}
              <img
                src={m.src}
                alt={m.alt}
                className="ld-photo ab-mosaic-img"
                loading="lazy"
                decoding="async"
                draggable={false}
                style={{ objectPosition: m.focus }}
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/** About Rendly (the product, not the company). */
export default function About() {
  return (
    <SiteShell>
      <Hero />
      <Problem />
      <HowItWorks />
      <Principles />
      <Mosaic />
      <FinalCta />
    </SiteShell>
  );
}
