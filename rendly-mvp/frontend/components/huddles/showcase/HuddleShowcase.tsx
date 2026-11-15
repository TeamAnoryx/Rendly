'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { runPet, type PetStep } from './petEngine';
import './huddle-showcase.css';

/** Composition size in design pixels (from the Figma frames); scaled to fit the panel. */
const W = 1260;
const H = 1080;
const TYPED = '#ai builders';
const TYPE_MS = 65;

const CATEGORIES = [
  { name: 'AI', a: '#8b6cff', b: '#3b1fd1' },
  { name: 'Design', a: '#ff8a8a', b: '#c0182a' },
  { name: 'Startups', a: '#ffc15e', b: '#e06a00' },
  { name: 'Music', a: '#5fe0d3', b: '#0f8b80' },
  { name: 'Gaming', a: '#ff82bd', b: '#b5146a' },
  { name: 'More', a: '#e6e6e6', b: '#9a9a9a' },
] as const;
const TABS = ['Agenda', 'Speakers', 'Reviews', 'Rewards'] as const;
const ROWS = [
  ['mic', 'Opening talk', 'Agents, tools & demos · 19:30'],
  ['sparkles', 'Live build session', 'Ship a feature together · 20:00'],
] as const;
const REVIEW_ROWS = [
  ['star', 'Best huddle this month', '“Clear, fun and useful” · Leo'],
  ['chat', 'Great Q&A at the end', '“Every question answered” · Ana'],
] as const;

/** Flight script, in composition coordinates. Phone A sits left/front, phone B right/back. */
const SCRIPT: PetStep[] = [
  { pt: [1220, 70], instant: true },
  { el: 'search', action: 'type', pause: 320 },
  { el: 'tile-ai', action: 'tile', pause: 320 },
  { el: 'up-card', action: 'card', pause: 420 },
  { pt: [1210, 660] },
  { pt: [900, 580], z: 'back' },
  { pt: [960, 110], z: 'back' },
  { pt: [990, -10] },
  { el: 'tab-reviews', action: 'tab', pause: 480 },
  { el: 'join', action: 'join', pause: 800 },
  { pt: [30, 820] },
  { pt: [330, 800], z: 'back' },
  { pt: [440, 1070], z: 'back' },
  { el: 'bell', action: 'bell', pause: 1600 },
];

type JoinState = 'idle' | 'pressed' | 'loading' | 'joined';

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export interface HuddleShowcaseProps {
  className?: string;
}

export default function HuddleShowcase({ className }: HuddleShowcaseProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const compRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scaleRef = useRef(0);
  const [scale, setScale] = useState(0);

  const [search, setSearch] = useState('');
  const [tile, setTile] = useState<number | null>(null);
  const [cardPress, setCardPress] = useState(false);
  const [detailKey, setDetailKey] = useState(0);
  const [tab, setTab] = useState(0);
  const [join, setJoin] = useState<JoinState>('idle');
  const [toast, setToast] = useState(false);
  const [bell, setBell] = useState(0);

  // Fit the fixed-size composition into whatever space the panel has.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const s = Math.min(box.clientWidth / W, box.clientHeight / H);
      scaleRef.current = s;
      setScale(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const onAction = useCallback(async (action: string) => {
    switch (action) {
      case 'type':
        for (let i = 1; i <= TYPED.length; i++) {
          setSearch(TYPED.slice(0, i));
          await wait(TYPE_MS);
        }
        break;
      case 'tile':
        setTile(0);
        break;
      case 'card':
        setCardPress(true);
        await wait(200);
        setCardPress(false);
        setDetailKey((k) => k + 1);
        setTab(0);
        break;
      case 'tab':
        setTab(2);
        break;
      case 'join':
        setJoin('pressed');
        await wait(160);
        setJoin('loading');
        await wait(750);
        setJoin('joined');
        setToast(true);
        window.setTimeout(() => setToast(false), 1900);
        break;
      case 'bell':
        setBell((b) => b + 1);
        await wait(500);
        setSearch('');
        setTile(null);
        setTab(0);
        setJoin('idle');
        break;
      default:
        break;
    }
  }, []);

  const ready = scale > 0;
  useEffect(() => {
    if (!ready) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const comp = compRef.current;
    const layer = layerRef.current;
    const canvas = canvasRef.current;
    if (!comp || !layer || !canvas) return;
    return runPet({ comp, layer, canvas, width: W, height: H, getScale: () => scaleRef.current, steps: SCRIPT, onAction });
  }, [ready, onAction]);

  const rows = tab === 2 ? REVIEW_ROWS : ROWS;

  return (
    <div ref={boxRef} className={`scx ${className ?? ''}`} aria-hidden>
      <div
        ref={compRef}
        className="scx-comp"
        style={{ width: W, height: H, transform: `translateY(-50%) scale(${scale || 0.0001})` }}
      >
        <div className="scx-pills scx-pills--tl">
          <span className="scx-pill">Rendly</span>
          <span className="scx-pill">Huddles</span>
        </div>
        <div className="scx-pills scx-pills--br">
          <span className="scx-pill">Live rooms</span>
          <span className="scx-pill">iOS</span>
        </div>

        {/* Phone B: huddle detail (behind, right) */}
        <div className="scx-phone scx-phone--b">
          <i className="scx-hw scx-hw--action" />
          <i className="scx-hw scx-hw--volup" />
          <i className="scx-hw scx-hw--voldn" />
          <PortStrip />
          <div className="scx-bezel">
            <div className="scx-screen">
              <StatusBar />
              <div key={detailKey} className="sd">
                <span className="sd-circle sd-back">
                  <Icon name="back" size={18} />
                </span>
                <span className="scx-avatar scx-avatar--host sd-photo" />
                <span className="sd-circle sd-share">
                  <Icon name="upload" size={17} />
                </span>
                <span className="sd-circle sd-heart">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                    <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" fill="#E5484D" />
                  </svg>
                </span>
                <p className="sd-name">
                  Mary Andersen <span className="sd-top">★ Top</span>
                </p>
                <p className="sd-role">Host · AI Builders Night</p>
                <div className="sd-stats">
                  {[
                    ['2k', 'Joined'],
                    ['45 min', 'Session'],
                    ['120', 'Seats'],
                  ].map(([a, b]) => (
                    <span key={b} className="sd-stat">
                      <strong>{a}</strong>
                      {b}
                    </span>
                  ))}
                </div>
                <ul className="sd-info">
                  <li>
                    <span className="sd-star">★</span> 4.8 <em>(1.2k reviews)</em>
                  </li>
                  <li>
                    <Icon name="door" size={16} className="sd-teal" /> Rendly Live · Seminar room
                  </li>
                  <li>
                    <Icon name="globe" size={16} className="sd-blue" /> English, French, Spanish
                  </li>
                </ul>
                <div className="sd-tabs">
                  {TABS.map((t, i) => (
                    <span key={t} data-sc={`tab-${t.toLowerCase()}`} className={`sd-tab ${tab === i ? 'sd-tab--on' : ''}`}>
                      {t}
                      {tab === i ? <span className="sd-tab-bar" /> : null}
                    </span>
                  ))}
                </div>
                <div key={tab} className="sd-rows">
                  {rows.map(([ic, a, b]) => (
                    <div key={a} className="sd-row">
                      <span className="sd-row-ic">
                        <Icon name={ic} size={18} />
                      </span>
                      <span className="sd-row-text">
                        <strong>{a}</strong>
                        {b}
                      </span>
                      <Icon name="chevron-right" size={16} />
                    </div>
                  ))}
                </div>
                <div className="sd-actions">
                  <span data-sc="join" className={`sd-join sd-join--${join}`}>
                    {join === 'loading' ? <span className="sd-spin" /> : join === 'joined' ? <>✓&nbsp; You&apos;re in</> : 'Join Huddle'}
                  </span>
                  <span className="sd-chat">
                    <Icon name="chat" size={22} />
                  </span>
                </div>
                <div className={`sd-toast ${toast ? 'sd-toast--on' : ''}`}>
                  <span className="sd-toast-dot">✓</span> Seat saved for 19:30
                </div>
              </div>
              <span className="scx-home-ind" />
            </div>
          </div>
          <div className="scx-float scx-float--price">
            <strong>Free</strong>
            <span>Entry · 120 seats</span>
          </div>
        </div>

        {/* Phone A: huddles home (front, left) */}
        <div className="scx-phone scx-phone--a">
          <i className="scx-hw scx-hw--power" />
          <PortStrip />
          <div className="scx-bezel">
            <div className="scx-screen">
              <StatusBar />
              <div className="sh">
                <div className="sh-head">
                  <div className="sh-hi">
                    <p className="sh-hello">Hello, Amanda</p>
                    <p className="sh-loc">
                      <Icon name="map-pin" size={15} className="sd-teal" /> Paris, France
                    </p>
                  </div>
                  <span key={bell} data-sc="bell" className={`sd-circle sh-bell ${bell ? 'sh-bell--ring' : ''}`}>
                    <Icon name="bell" size={18} />
                  </span>
                  <span className="scx-avatar scx-avatar--me" />
                </div>
                <div data-sc="search" className={`sh-search ${search ? 'sh-search--on' : ''}`}>
                  <Icon name="search" size={18} />
                  {search ? (
                    <span className="sh-typed">
                      {search}
                      <i className="sh-caret" />
                    </span>
                  ) : (
                    <span className="sh-ph">Search a huddle, intent or link</span>
                  )}
                </div>
                <div className="sh-grid">
                  {CATEGORIES.map((c, i) => (
                    <span
                      key={c.name}
                      data-sc={i === 0 ? 'tile-ai' : undefined}
                      className={`sh-tile ${tile === i ? 'sh-tile--on' : ''} ${tile !== null && tile !== i ? 'sh-tile--dim' : ''}`}
                    >
                      <span className="sh-orb" style={{ ['--a' as string]: c.a, ['--b' as string]: c.b }} />
                      {c.name}
                    </span>
                  ))}
                </div>
                <div className="sh-dm">
                  <span className="sh-date">
                    <em>Monday</em>
                    <strong>21</strong>
                    <em>Jan</em>
                  </span>
                  <span className="sh-map">
                    <svg viewBox="0 0 222 126" preserveAspectRatio="none" aria-hidden>
                      <path d="M0 22H222M0 100H222M62 0V126M150 0V126" stroke="#fff" strokeWidth="3" />
                      <path className="sh-river" d="M-10 60C40 40 70 95 120 80S190 30 240 55" stroke="#86bfe9" strokeWidth="16" fill="none" />
                    </svg>
                    <span className="sh-pin sh-pin--1">
                      <span className="scx-avatar scx-avatar--sm" />★ 5.0
                    </span>
                    <span className="sh-pin sh-pin--2">
                      <span className="scx-avatar scx-avatar--sm scx-avatar--alt" />★ 4.9
                    </span>
                  </span>
                </div>
                <div className="sh-uphead">
                  <strong>Upcoming huddles</strong>
                  <span>
                    See All <Icon name="chevron-right" size={13} />
                  </span>
                </div>
                <span className="sh-slot" />
              </div>
              <div className="sh-tabbar">
                <span className="sh-tab-home">
                  <Icon name="home" size={17} /> Home
                </span>
                <Icon name="calendar" size={19} />
                <Icon name="chat" size={19} />
                <Icon name="settings" size={19} />
              </div>
              <span className="scx-home-ind" />
            </div>
          </div>
          {/* The upcoming card pops out past the phone edge, like the reference. */}
          <div data-sc="up-card" className={`scx-float scx-float--card ${cardPress ? 'scx-float--press' : ''}`}>
            <div className="uc-top">
              <span className="scx-avatar scx-avatar--host uc-av" />
              <span className="uc-text">
                <strong>AI Builders Night</strong>
                <span>Hosted by Mary Andersen</span>
                <span className="uc-ok">✓ Confirmed</span>
              </span>
              <span className="uc-dots">⋮</span>
            </div>
            <div className="uc-meta">
              <span>
                <i>
                  <Icon name="calendar" size={15} />
                </i>
                <span>
                  <em>Date</em>Jan 21, 2026
                </span>
              </span>
              <span>
                <i>
                  <Icon name="clock" size={15} />
                </i>
                <span>
                  <em>Time</em>19:30
                </span>
              </span>
            </div>
          </div>
        </div>

        <div ref={layerRef} className="scp-layer">
          <canvas ref={canvasRef} className="scp-canvas" style={{ width: W, height: H }} />
        </div>
      </div>
    </div>
  );
}

/** Speaker holes and the USB-C port on the phone's bottom edge. */
function PortStrip() {
  const holes = [0, 1, 2, 3, 4];
  return (
    <span className="scx-port">
      <span className="scx-grill">
        {holes.map((i) => (
          <i key={i} />
        ))}
      </span>
      <span className="scx-usb" />
      <span className="scx-grill">
        {holes.map((i) => (
          <i key={i} />
        ))}
      </span>
    </span>
  );
}

function StatusBar() {
  return (
    <div className="scx-status">
      <span>9:41</span>
      <span className="scx-island" />
      <span className="scx-sys">
        <i className="scx-sig" />
        <i className="scx-batt" />
      </span>
    </div>
  );
}
