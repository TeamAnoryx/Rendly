'use client';

import React from 'react';
import Reveal from './Reveal';
import { IconHuddles, IconSpark, IconVideo, IconWhispers } from './icons';
import { PersonAvatar, PersonPhoto } from './people';
import { FEATURES_PHOTOS } from './photos';

/** Tracks the pointer so `.rd-card--glow` can light its border where the cursor is. */
function onGlowMove(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

function SparkMini() {
  return (
    <div className="ld-mini" aria-hidden="true">
      <div className="ld-mini-chips">
        <span className="ld-chip is-on">Co-founder</span>
        <span className="ld-chip">Mentor</span>
        <span className="ld-chip">Hiring</span>
      </div>
      <div className="ld-mini-match">
        <PersonAvatar photo={FEATURES_PHOTOS.spark} size="md" online />
        <div className="ld-mini-match-id">
          <span className="ld-mini-strong">{FEATURES_PHOTOS.spark.name}</span>
          <span className="ld-mini-muted">Wants a co-founder</span>
        </div>
        <span className="ld-fake-btn ld-fake-btn--primary ld-fake-btn--sm">
          <IconVideo size={12} />
          Connect
        </span>
      </div>
    </div>
  );
}

function WhispersMini() {
  return (
    <div className="ld-mini ld-mini--chat" aria-hidden="true">
      <div className="ld-bubble ld-bubble--in">Loved the call. Want to sketch the MVP this week?</div>
      <div className="ld-bubble ld-bubble--out">Yes. Thursday works, I&apos;ll bring the deck.</div>
      <div className="ld-bubble ld-bubble--in ld-typing">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

function HuddlesMini() {
  return (
    <div className="ld-mini" aria-hidden="true">
      <div className="ld-mini-head">
        <span className="ld-mini-strong">Founders circle</span>
        <span className="rd-badge rd-badge--live">Live</span>
      </div>
      <div className="ld-mini-grid">
        {FEATURES_PHOTOS.circle.map((p, i) => (
          <span key={p.initials} className={`ld-mini-tile ld-cam${i === 1 ? ' is-speaking' : ''}`}>
            <PersonPhoto photo={p} className="ld-cam-img" decorative />
            <span className="ld-mini-tile-name">{p.name.split(' ')[0]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const CARDS = [
  {
    id: 'spark',
    title: 'Spark',
    Icon: IconSpark,
    copy: 'Pick an intent and get matched one-to-one with someone who wants the same thing. Video and chat open instantly.',
    Mini: SparkMini,
  },
  {
    id: undefined,
    title: 'Whispers',
    Icon: IconWhispers,
    copy: 'Direct messages and group chats with your connections. Threads from calls carry straight over.',
    Mini: WhispersMini,
  },
  {
    id: undefined,
    title: 'Huddles',
    Icon: IconHuddles,
    copy: 'Scheduled or live group video rooms for the conversations that need more than two people.',
    Mini: HuddlesMini,
  },
];

export default function Features() {
  return (
    <section id="product" className="ld-section" aria-labelledby="ld-features-title">
      <div className="ld-container">
        <header className="ld-section-head">
          <Reveal as="p" className="ld-eyebrow">
            Built for intent
          </Reveal>
          <Reveal as="h2" delay={60} id="ld-features-title" className="ld-h2">
            Every connection starts with a reason.
          </Reveal>
          <Reveal as="p" delay={120} className="ld-lede">
            No feeds to scroll, no follower counts to chase. Tell Rendly what you are looking for and it does the
            introducing.
          </Reveal>
        </header>

        <ul className="ld-feature-grid">
          {CARDS.map(({ id, title, Icon, copy, Mini }, i) => (
            <Reveal as="li" key={title} delay={i * 70} id={id} className="ld-feature-item">
              <article className="rd-card rd-card--glow ld-feature" onPointerMove={onGlowMove}>
                <div className="ld-feature-visual">
                  <Mini />
                </div>
                <div className="ld-feature-body">
                  <h3 className="ld-feature-title">
                    <span className="ld-feature-icon">
                      <Icon size={15} />
                    </span>
                    {title}
                  </h3>
                  <p className="ld-feature-copy">{copy}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
