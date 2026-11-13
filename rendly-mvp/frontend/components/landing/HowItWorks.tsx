import React from 'react';
import Reveal from './Reveal';
import { IconHuddles, IconSpark, IconTarget } from './icons';

const STEPS = [
  {
    n: '01',
    title: 'Choose your intents',
    copy: 'Co-founder, mentor, hiring, collaborating. Pick what you are here for and the interests that shape it.',
    Icon: IconTarget,
  },
  {
    n: '02',
    title: 'Spark a match',
    copy: 'Rendly pairs you with someone who shares that intent. Say hello on video or keep it to chat.',
    Icon: IconSpark,
  },
  {
    n: '03',
    title: 'Build connections',
    copy: 'Keep the conversation going in Whispers, meet in Huddles and earn points as you show up.',
    Icon: IconHuddles,
  },
];

export default function HowItWorks() {
  return (
    <section className="ld-section ld-section--bordered" aria-labelledby="ld-how-title">
      <div className="ld-container">
        <header className="ld-section-head">
          <Reveal as="p" className="ld-eyebrow">
            How it works
          </Reveal>
          <Reveal as="h2" delay={60} className="ld-h2">
            <span id="ld-how-title">From intent to introduction in three steps.</span>
          </Reveal>
        </header>

        <ol className="ld-steps">
          {STEPS.map(({ n, title, copy, Icon }, i) => (
            <Reveal as="li" key={n} delay={i * 80} className="ld-step">
              <div className="ld-step-rail" aria-hidden="true">
                <span className="ld-step-node">
                  <Icon size={14} />
                </span>
                <span className="ld-step-line" />
              </div>
              <div className="ld-step-body">
                <span className="ld-step-num rd-mono">{n}</span>
                <h3 className="ld-step-title">{title}</h3>
                <p className="ld-step-copy">{copy}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
