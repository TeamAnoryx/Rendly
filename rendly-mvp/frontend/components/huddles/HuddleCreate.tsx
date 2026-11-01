'use client';

import React, { useState, useCallback, useEffect } from 'react';
import type { CreateHuddlePayload, CreateHuddleResponse, HuddleMode } from '@/services/huddlesApi';
import { HUDDLE_MODE_LABELS } from '@/services/huddlesApi';
import { getConnections, type Connection } from '@/services/connectionsApi';
import { buildScheduledAt } from '@/lib/huddleSchedule';

type HuddleCreateProps = {
  onCreate: (payload: CreateHuddlePayload) => Promise<CreateHuddleResponse>;
  onCancel: () => void;
  onSuccess: () => void;
};

const HUDDLE_TYPES = ['public', 'private', 'instant'] as const;
const MAX_MEMBERS_OPTIONS = [10, 15, 20, 50] as const;
const MODES: HuddleMode[] = ['open', 'seminar', 'hackathon', 'launch'];
const MAX_INTENTS = 5;
const INTENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

/** Normalise one intent typed by the user: lowercase, no leading #, spaces become hyphens. */
export function normaliseIntent(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
}

export default function HuddleCreate({ onCreate, onCancel, onSuccess }: HuddleCreateProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<CreateHuddlePayload['type']>('public');
  const [maxParticipants, setMaxParticipants] = useState<10 | 15 | 20 | 50>(10);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('12:00');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [mode, setMode] = useState<HuddleMode>('open');
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [intents, setIntents] = useState<string[]>([]);
  const [intentDraft, setIntentDraft] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getConnections()
      .then((list) => {
        if (!cancelled) setConnections(list);
      })
      .catch(() => {
        // Without the list the user can still create a huddle with no invitees.
      });
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

  const toggleInvitee = useCallback((id: string) => {
    setInviteeIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      const trimmedTitle = title.trim().replace(/^@/, '');
      if (!trimmedTitle) {
        setSubmitError('Huddle name is required');
        return;
      }
      if (!MAX_MEMBERS_OPTIONS.includes(maxParticipants)) {
        setSubmitError('Please select max members (10, 15, 20, or 50)');
        return;
      }
      if (durationMinutes < 1 || durationMinutes > 30) {
        setSubmitError('Duration must be between 1 and 30 minutes');
        return;
      }
      let scheduledAt: string | null = null;
      if (date && time) {
        scheduledAt = buildScheduledAt(date, time);
        if (!scheduledAt) {
          setSubmitError('Please enter a valid date and time');
          return;
        }
      }
      setSubmitting(true);
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
          intents,
          invitee_ids: inviteeIds,
        });
        setCreatedInviteUrl(result.invite_url);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to create huddle');
      } finally {
        setSubmitting(false);
      }
    },
    [title, description, type, maxParticipants, date, time, durationMinutes, mode, waitingRoom, intents, inviteeIds, onCreate]
  );

  const handleCopyInvite = useCallback(() => {
    if (!createdInviteUrl) return;
    navigator.clipboard.writeText(createdInviteUrl).then(
      () => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      },
      () => {}
    );
  }, [createdInviteUrl]);

  const handleDone = useCallback(() => {
    setCreatedInviteUrl(null);
    onSuccess();
  }, [onSuccess]);

  if (createdInviteUrl) {
    return (
      <div className="dash-huddles-create dash-huddles-create--success">
        <h1 className="dash-huddles-create-title">Create Huddle</h1>
        <div className="dash-huddles-create-invite-box">
          <p className="dash-huddles-create-invite-label">Huddle link</p>
          <div className="dash-huddles-create-invite-row">
            <input
              type="text"
              readOnly
              value={createdInviteUrl}
              className="dash-huddles-create-invite-input"
              aria-label="Huddle link"
            />
            <button
              type="button"
              className="dash-huddles-create-invite-copy"
              onClick={handleCopyInvite}
              aria-label="Copy huddle link"
            >
              {copySuccess ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {type === 'private' && (
            <p className="dash-huddles-create-hint">Only the people you invited can open this huddle.</p>
          )}
          <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--primary" onClick={handleDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-huddles-create">
      <h1 className="dash-huddles-create-title">Create Huddle</h1>
      <form onSubmit={handleSubmit} className="dash-huddles-create-form">
        <div className="dash-huddles-create-block">
          <label className="dash-huddles-create-label" htmlFor="huddle-name">
            Huddle:
          </label>
          <input
            id="huddle-name"
            type="text"
            placeholder="@huddle-name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="dash-huddles-create-input"
          />
          <label className="dash-huddles-create-label" htmlFor="huddle-desc">
            Description:
          </label>
          <textarea
            id="huddle-desc"
            placeholder="Describe your huddle…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="dash-huddles-create-textarea"
            rows={3}
          />
          <label className="dash-huddles-create-label" htmlFor="huddle-intent">
            Intents (like hashtags, up to {MAX_INTENTS}):
          </label>
          <div className="dash-huddles-create-options">
            {intents.map((tag) => (
              <button
                key={tag}
                type="button"
                className="dash-huddles-create-opt dash-huddles-create-opt--on"
                onClick={() => setIntents(intents.filter((t) => t !== tag))}
                aria-label={`Remove intent ${tag}`}
              >
                #{tag} ×
              </button>
            ))}
          </div>
          <div className="dash-huddles-create-report-row">
            <input
              id="huddle-intent"
              type="text"
              placeholder="e.g. ai, hackathon"
              value={intentDraft}
              onChange={(e) => setIntentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addIntent();
                }
              }}
              className="dash-huddles-create-input"
            />
            <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--secondary" onClick={addIntent}>
              Add
            </button>
          </div>
        </div>

        <div className="dash-huddles-create-columns">
          <div className="dash-huddles-create-col">
            <div className="dash-huddles-create-card">
              <h3 className="dash-huddles-create-card-title">Huddle Type & Max Members</h3>
              <label className="dash-huddles-create-label">Huddle Type:</label>
              <div className="dash-huddles-create-options">
                {HUDDLE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`dash-huddles-create-opt ${type === t ? 'dash-huddles-create-opt--on' : ''}`}
                    onClick={() => setType(t)}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <label className="dash-huddles-create-label">Format:</label>
              <div className="dash-huddles-create-options">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`dash-huddles-create-opt ${mode === m ? 'dash-huddles-create-opt--on' : ''}`}
                    onClick={() => setMode(m)}
                  >
                    {HUDDLE_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              <p className="dash-huddles-create-hint">
                Seminar and app-launch audiences start listening only; you give them the floor.
              </p>
              <label className="dash-huddles-create-label">Max members:</label>
              <div className="dash-huddles-create-options">
                {MAX_MEMBERS_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`dash-huddles-create-opt ${maxParticipants === n ? 'dash-huddles-create-opt--on' : ''}`}
                    onClick={() => setMaxParticipants(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <label className="dash-huddles-create-label">
                <input type="checkbox" checked={waitingRoom} onChange={(e) => setWaitingRoom(e.target.checked)} />{' '}
                Waiting room: you let each person in
              </label>
            </div>

            <div className="dash-huddles-create-card">
              <h3 className="dash-huddles-create-card-title">Invite connections</h3>
              {connections.length === 0 ? (
                <p className="dash-huddles-create-hint">Connect with people first, then invite them here.</p>
              ) : (
                <ul className="dash-huddles-create-invitees">
                  {connections.map((c) => (
                    <li key={c.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={inviteeIds.includes(c.id)}
                          onChange={() => toggleInvitee(c.id)}
                        />{' '}
                        {c.username ?? 'User'}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {type === 'private' && (
                <p className="dash-huddles-create-hint">Private huddles are open only to people you invite here.</p>
              )}
            </div>
            <button
              type="submit"
              className="dash-huddles-create-btn dash-huddles-create-btn--primary"
              disabled={submitting}
            >
              {submitting ? 'Scheduling…' : 'Schedule this huddle'}
            </button>
          </div>

          <div className="dash-huddles-create-col">
            <div className="dash-huddles-create-card">
              <h3 className="dash-huddles-create-card-title">Huddle Scheduler</h3>
              <label className="dash-huddles-create-label" htmlFor="huddle-date">
                Date:
              </label>
              <input
                id="huddle-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="dash-huddles-create-input"
              />
              <label className="dash-huddles-create-label" htmlFor="huddle-time">
                Time (24-hour):
              </label>
              <input
                id="huddle-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="dash-huddles-create-input"
              />
              <label className="dash-huddles-create-label" htmlFor="huddle-duration">
                Duration: <span className="dash-huddles-create-hint">(max 30 min)</span>
              </label>
              <input
                id="huddle-duration"
                type="number"
                min={1}
                max={30}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value) || 30)}
                className="dash-huddles-create-input"
              />
            </div>
          </div>
        </div>

        {submitError && (
          <p className="dash-huddles-create-error" role="alert">
            {submitError}
          </p>
        )}
        <div className="dash-huddles-create-actions">
          <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--secondary" onClick={onCancel}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
