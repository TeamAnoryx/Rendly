'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreateHuddlePayload, CreateHuddleResponse, HuddleMode } from '@/services/huddlesApi';
import { HUDDLE_MODE_LABELS, uploadHuddleThumbnail, videoDurationSeconds } from '@/services/huddlesApi';
import { getConnections, type Connection } from '@/services/connectionsApi';
import { buildScheduledAt } from '@/lib/huddleSchedule';
import { Icon } from '@/components/shell/Icon';

type HuddleCreateProps = {
  onCreate: (payload: CreateHuddlePayload) => Promise<CreateHuddleResponse>;
  onCancel: () => void;
  onSuccess: (huddleId: string) => void;
};

const HUDDLE_TYPES = ['public', 'private', 'instant'] as const;
const MAX_MEMBERS_OPTIONS = [10, 15, 20, 50] as const;
const MODES: HuddleMode[] = ['open', 'seminar', 'hackathon', 'launch'];
const MAX_INTENTS = 5;
const INTENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;
const PROMO_MAX_SECONDS = 15;
const THUMB_MAX_BYTES = 30 * 1024 * 1024;
const TYPE_HINT: Record<(typeof HUDDLE_TYPES)[number], string> = {
  public: 'Anyone can find and join',
  private: 'Only people you invite',
  instant: 'Starts now, open to all',
};

/** Normalise one intent typed by the user: lowercase, no leading #, spaces become hyphens. */
export function normaliseIntent(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
}

function Seg<T extends string | number>({ value, options, onChange, label, render }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; render?: (v: T) => React.ReactNode }) {
  return (
    <div className="hc-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o)} type="button" role="radio" aria-checked={value === o} className={`hc-seg-btn ${value === o ? 'hc-seg-btn--on' : ''}`} onClick={() => onChange(o)}>
          {render ? render(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className="hr-switch-row">
      <span>
        <strong>{title}</strong>
        <span className="rd-small rd-muted">{hint}</span>
      </span>
      <input type="checkbox" className="hr-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function HuddleCreate({ onCreate, onCancel, onSuccess }: HuddleCreateProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<(typeof HUDDLE_TYPES)[number]>('public');
  const [maxParticipants, setMaxParticipants] = useState<10 | 15 | 20 | 50>(10);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('12:00');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [mode, setMode] = useState<HuddleMode>('open');
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [allowSelfExit, setAllowSelfExit] = useState(true);
  const [rewards, setRewards] = useState(true);
  const [intents, setIntents] = useState<string[]>([]);
  const [intentDraft, setIntentDraft] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);
  const [thumb, setThumb] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState<null | 'create' | 'upload'>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; url: string; thumbError: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbUrl = useMemo(() => (thumb ? URL.createObjectURL(thumb) : null), [thumb]);
  useEffect(() => () => {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  }, [thumbUrl]);

  useEffect(() => {
    let cancelled = false;
    getConnections()
      .then((list) => !cancelled && setConnections(list))
      .catch(() => undefined); // the huddle can still be created without invitees
    return () => {
      cancelled = true;
    };
  }, []);

  const addIntent = useCallback(() => {
    const tag = normaliseIntent(intentDraft);
    if (!tag) return;
    if (!INTENT_PATTERN.test(tag)) {
      setSubmitError('Intents use lowercase letters, digits and hyphens (30 characters at most)');
      return;
    }
    if (intents.includes(tag)) {
      setIntentDraft('');
      return;
    }
    if (intents.length >= MAX_INTENTS) {
      setSubmitError(`A huddle can have at most ${MAX_INTENTS} intents`);
      return;
    }
    setSubmitError(null);
    setIntents([...intents, tag]);
    setIntentDraft('');
  }, [intentDraft, intents]);

  const pickThumb = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setSubmitError(null);
    if (file.size > THUMB_MAX_BYTES) {
      setSubmitError('That file is larger than 30 MB.');
      return;
    }
    if (file.type.startsWith('video/')) {
      try {
        const secs = await videoDurationSeconds(file);
        if (secs > PROMO_MAX_SECONDS + 0.5) {
          setSubmitError(`Promo videos can be at most ${PROMO_MAX_SECONDS} seconds (this one is ${Math.round(secs)} s).`);
          return;
        }
      } catch {
        setSubmitError('Could not read that video.');
        return;
      }
    }
    setThumb(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const trimmedTitle = title.trim().replace(/^@/, '');
    if (!trimmedTitle) return setSubmitError('Give your huddle a name');
    if (durationMinutes < 1 || durationMinutes > 30) return setSubmitError('Duration must be between 1 and 30 minutes');
    let scheduledAt: string | null = null;
    if (type !== 'instant' && date && time) {
      scheduledAt = buildScheduledAt(date, time);
      if (!scheduledAt) return setSubmitError('Please enter a valid date and time');
    }
    setSubmitting('create');
    try {
      const result = await onCreate({
        title: trimmedTitle,
        description: description.trim() || null,
        max_participants: maxParticipants,
        type,
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        settings: {},
        mode,
        waiting_room: waitingRoom,
        allow_self_exit: allowSelfExit,
        rewards_enabled: rewards,
        intents,
        invitee_ids: inviteeIds,
      });
      let thumbError: string | null = null;
      if (thumb) {
        setSubmitting('upload');
        try {
          await uploadHuddleThumbnail(result.id, thumb);
        } catch (err) {
          thumbError = err instanceof Error ? err.message : 'The thumbnail could not be uploaded';
        }
      }
      setCreated({ id: result.id, url: result.invite_url, thumbError });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create huddle');
    } finally {
      setSubmitting(null);
    }
  };

  if (created) {
    return (
      <div className="hc hc--done rd-card">
        <div className="hc-done-icon">
          <Icon name="check" size={28} />
        </div>
        <h2 className="rd-h1">Your huddle is ready</h2>
        <p className="rd-muted">Share the link{type === 'private' ? ' with the people you invited' : ''}.</p>
        <div className="hc-link">
          <input className="rd-input" readOnly value={created.url} aria-label="Huddle link" />
          <button
            type="button"
            className="rd-btn"
            onClick={() =>
              navigator.clipboard.writeText(created.url).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                },
                () => undefined
              )
            }
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {created.thumbError ? <p className="hl-err rd-small">Thumbnail: {created.thumbError}. You can add it from the huddle page.</p> : null}
        <div className="hc-actions">
          <button type="button" className="rd-btn rd-btn--primary rd-btn--lg" onClick={() => onSuccess(created.id)}>
            Open huddle
          </button>
          <button type="button" className="rd-btn rd-btn--ghost" onClick={onCancel}>
            Back to huddles
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="hc rd-card" onSubmit={handleSubmit}>
      <header className="hc-head">
        <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={onCancel}>
          <Icon name="back" size={16} /> Back
        </button>
        <h2 className="rd-h2">New huddle</h2>
        <button type="submit" className="rd-btn rd-btn--primary" disabled={!!submitting}>
          {submitting ? <span className="rd-spinner" /> : <Icon name="plus" size={16} />}
          {submitting === 'upload' ? 'Uploading…' : submitting ? 'Creating…' : 'Create'}
        </button>
      </header>

      <div className="hc-body rd-scroll">
        <div className="hc-col">
          <button type="button" className="hc-thumb" onClick={() => fileRef.current?.click()} aria-label="Add a poster image or a 15-second promo video">
            {thumb && thumbUrl ? (
              thumb.type.startsWith('video/') ? (
                <video src={thumbUrl} autoPlay muted loop playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt="" />
              )
            ) : (
              <span className="hc-thumb-empty">
                <Icon name="upload" size={24} />
                <strong>Poster or 15 s promo</strong>
                <span className="rd-small rd-muted">JPG, PNG, WebP, MP4 or WebM · up to 30 MB</span>
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(e) => void pickThumb(e.target.files?.[0])} />
          {thumb ? (
            <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => setThumb(null)}>
              Remove thumbnail
            </button>
          ) : null}

          <label className="rd-label" htmlFor="hc-title">
            Name
          </label>
          <input id="hc-title" className="rd-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday AI quiz night" />
          <label className="rd-label" htmlFor="hc-desc">
            Description
          </label>
          <textarea id="hc-desc" className="rd-textarea" rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="What will happen in this huddle?" />

          <label className="rd-label" htmlFor="hc-intent">
            Intents (up to {MAX_INTENTS})
          </label>
          <div className="hc-intents">
            {intents.map((tag) => (
              <button key={tag} type="button" className="rd-chip rd-chip--on" onClick={() => setIntents(intents.filter((t) => t !== tag))} aria-label={`Remove ${tag}`}>
                #{tag} <Icon name="close" size={12} />
              </button>
            ))}
            <input
              id="hc-intent"
              className="rd-input hc-intent-input"
              value={intentDraft}
              onChange={(e) => setIntentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addIntent();
                }
              }}
              placeholder="#ai, #design… press Enter"
              disabled={intents.length >= MAX_INTENTS}
            />
          </div>
        </div>

        <div className="hc-col">
          <span className="rd-label">Who can join</span>
          <Seg value={type} options={HUDDLE_TYPES} onChange={setType} label="Huddle type" render={(t) => <span className="hc-seg-txt"><strong>{t}</strong><small>{TYPE_HINT[t]}</small></span>} />
          <span className="rd-label">Format</span>
          <Seg value={mode} options={MODES} onChange={setMode} label="Format" render={(m) => HUDDLE_MODE_LABELS[m]} />
          <span className="rd-label">Seats</span>
          <Seg value={maxParticipants} options={MAX_MEMBERS_OPTIONS} onChange={setMaxParticipants} label="Max members" />

          {type !== 'instant' ? (
            <div className="hc-row3">
              <label>
                <span className="rd-label">Date</span>
                <input type="date" className="rd-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                <span className="rd-label">Time</span>
                <input type="time" className="rd-input" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
              <label>
                <span className="rd-label">Minutes</span>
                <input type="number" min={1} max={30} className="rd-input" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value) || 30)} />
              </label>
            </div>
          ) : null}

          <div className="hc-switches">
            <Switch checked={waitingRoom} onChange={setWaitingRoom} title="Waiting room" hint="You admit each person." />
            <Switch checked={allowSelfExit} onChange={setAllowSelfExit} title="People can leave freely" hint="Turn off to control entry and exit yourself." />
            <Switch checked={rewards} onChange={setRewards} title="Rewards" hint="Give points for quizzes and competitions." />
          </div>

          {connections.length ? (
            <>
              <span className="rd-label">Invite connections</span>
              <div className="hc-invitees rd-scroll">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`rd-chip ${inviteeIds.includes(c.id) ? 'rd-chip--on' : ''}`}
                    onClick={() => setInviteeIds((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                  >
                    @{c.username ?? 'user'}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
      {submitError ? <p className="hl-err hc-error" role="alert">{submitError}</p> : null}
    </form>
  );
}
