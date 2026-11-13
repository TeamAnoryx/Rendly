import React from 'react';
import Reveal from './Reveal';
import {
  IconCalendar,
  IconCheck,
  IconMic,
  IconMicOff,
  IconScreen,
  IconSend,
  IconVideo,
  IconWhispers,
} from './icons';
import { PersonAvatar, PersonPhoto, type Photo } from './people';
import { HUDDLE_PHOTOS, WHISPERS_PHOTOS } from './photos';

/** Room tiles are 16 / 11 (see .ld-room-tile). */
const ROOM_TILE_ASPECT = 16 / 11;
const SPEAKING = 1;
const MUTED = new Set([2, 4]);

const ROOM = HUDDLE_PHOTOS.map((photo, i) => ({ photo, speaking: i === SPEAKING, muted: MUTED.has(i) }));

function HuddleMock() {
  return (
    <div className="ld-frame ld-frame--band" aria-hidden="true">
      <div className="ld-room">
        <div className="ld-room-head">
          <div className="ld-room-title">
            <span className="ld-app-h">Climate builders</span>
            <span className="rd-badge rd-badge--live">Live</span>
          </div>
          <span className="ld-room-meta rd-mono">6 in room · 24:18</span>
        </div>
        <div className="ld-room-grid">
          {ROOM.map((p) => (
            <div
              key={p.photo.src}
              className={`ld-room-tile ld-cam${p.speaking ? ' is-speaking' : ''}`}
            >
              <PersonPhoto photo={p.photo} className="ld-cam-img" cropAspect={ROOM_TILE_ASPECT} decorative />
              {p.speaking && (
                <span className="ld-cam-eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              <span className="ld-room-name">
                {p.muted && <IconMicOff size={11} />}
                {p.photo.name}
              </span>
            </div>
          ))}
        </div>
        <div className="ld-controls ld-controls--room">
          <span className="ld-ctrl">
            <IconMic size={15} />
          </span>
          <span className="ld-ctrl">
            <IconVideo size={15} />
          </span>
          <span className="ld-ctrl ld-ctrl--hide-sm">
            <IconScreen size={15} />
          </span>
          <span className="ld-ctrl">
            <IconWhispers size={15} />
          </span>
          <span className="ld-fake-btn ld-fake-btn--leave">Leave</span>
        </div>
      </div>
    </div>
  );
}

const THREADS: ReadonlyArray<{
  i: string;
  name: string;
  photo?: Photo;
  preview: string;
  unread: number;
  online: boolean;
  active: boolean;
}> = [
  { i: 'LV', name: WHISPERS_PHOTOS.lena.name, photo: WHISPERS_PHOTOS.lena, preview: 'Thursday works for me', unread: 2, online: true, active: true },
  { i: 'CB', name: 'Climate builders', preview: 'Notes from today', unread: 0, online: false, active: false },
  { i: 'IJ', name: WHISPERS_PHOTOS.imani.name, photo: WHISPERS_PHOTOS.imani, preview: 'Great meeting you', unread: 0, online: true, active: false },
  { i: 'PG', name: 'Product guild', preview: 'Sent the intro', unread: 0, online: false, active: false },
];

function WhispersMock() {
  return (
    <div className="ld-frame ld-frame--band" aria-hidden="true">
      <div className="ld-dm">
        <aside className="ld-dm-list">
          <div className="ld-dm-list-head">Whispers</div>
          {THREADS.map((t) => (
            <div key={t.i} className={`ld-dm-row${t.active ? ' is-active' : ''}`}>
              {t.photo ? (
                <PersonAvatar photo={t.photo} size="sm" online={t.online} />
              ) : (
                <span className="ld-avatar ld-avatar--sm">{t.i}</span>
              )}
              <span className="ld-dm-row-text">
                <span className="ld-mini-strong">{t.name}</span>
                <span className="ld-mini-muted">{t.preview}</span>
              </span>
              {t.unread > 0 && <span className="ld-unread">{t.unread}</span>}
            </div>
          ))}
        </aside>
        <div className="ld-dm-thread">
          <div className="ld-dm-thread-head">
            <PersonAvatar photo={WHISPERS_PHOTOS.lena} size="sm" online />
            <span className="ld-dm-thread-id">
              <span className="ld-mini-strong">{WHISPERS_PHOTOS.lena.name}</span>
              <span className="ld-mini-muted">Matched on Co-founder</span>
            </span>
          </div>
          <div className="ld-dm-msgs">
            <span className="ld-dm-sep rd-mono">Call ended · 18 min</span>
            <div className="ld-bubble ld-bubble--in">That was the best intro call I&apos;ve had all month.</div>
            <div className="ld-bubble ld-bubble--out">Same. Want to map out the first version together?</div>
            <div className="ld-bubble ld-bubble--in">Thursday works for me. I&apos;ll bring sketches.</div>
            <div className="ld-bubble ld-bubble--in ld-typing">
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="ld-dm-composer">
            <span>Message Lena</span>
            <span className="ld-dm-send">
              <IconSend size={13} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface BandProps {
  id: string;
  eyebrow: string;
  title: string;
  copy: string;
  points: string[];
  Icon: (p: { size?: number }) => JSX.Element;
  mock: React.ReactNode;
  reverse?: boolean;
}

function Band({ id, eyebrow, title, copy, points, Icon, mock, reverse }: BandProps) {
  return (
    <div id={id} className={`ld-band${reverse ? ' ld-band--reverse' : ''}`}>
      <div className="ld-band-copy">
        <Reveal as="p" className="ld-eyebrow ld-eyebrow--icon">
          <Icon size={14} />
          {eyebrow}
        </Reveal>
        <Reveal as="h2" delay={60} className="ld-h2 ld-h2--band">
          {title}
        </Reveal>
        <Reveal as="p" delay={120} className="ld-lede">
          {copy}
        </Reveal>
        <ul className="ld-points">
          {points.map((p, i) => (
            <Reveal as="li" key={p} delay={180 + i * 60} className="ld-point">
              <IconCheck size={14} />
              <span>{p}</span>
            </Reveal>
          ))}
        </ul>
      </div>
      <Reveal delay={100} className="ld-band-visual">
        {mock}
      </Reveal>
    </div>
  );
}

export default function ProductBands() {
  return (
    <section className="ld-section ld-section--bordered" aria-label="Product details">
      <div className="ld-container ld-bands">
        <Band
          id="huddles"
          eyebrow="Huddles"
          title="Rooms for conversations that need more than two."
          copy="Bring your matches and connections together on video. Plan a session for later or open a room right now."
          points={[
            'Schedule ahead or go live instantly',
            'See who is speaking at a glance',
            'Room chat that stays in Whispers afterwards',
          ]}
          Icon={IconCalendar}
          mock={<HuddleMock />}
        />
        <Band
          id="whispers"
          eyebrow="Whispers"
          title="The conversation keeps going after the call."
          copy="Every match and huddle gets a thread. Pick up where you left off, one-to-one or with the whole group."
          points={[
            'Direct messages and group chats',
            'Messages sent during a call land in the same thread',
            'Typing indicators and unread counts',
          ]}
          Icon={IconWhispers}
          mock={<WhispersMock />}
          reverse
        />
      </div>
    </section>
  );
}
