'use client';

import React, { useState, useCallback } from 'react';
import type { CreateHuddlePayload, CreateHuddleResponse } from '@/services/huddlesApi';

type HuddleCreateProps = {
  onCreate: (payload: CreateHuddlePayload) => Promise<CreateHuddleResponse>;
  onCancel: () => void;
  onSuccess: () => void;
};

const HUDDLE_TYPES = ['public', 'private', 'instant'] as const;
const MAX_MEMBERS_OPTIONS = [10, 15, 20, 50] as const;

export default function HuddleCreate({ onCreate, onCancel, onSuccess }: HuddleCreateProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<CreateHuddlePayload['type']>('public');
  const [maxParticipants, setMaxParticipants] = useState<10 | 15 | 20 | 50>(10);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('12:00');
  const [amPm, setAmPm] = useState<'AM' | 'PM'>('AM');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [chatPermission, setChatPermission] = useState<'view_only' | 'allow'>('view_only');
  const [reportUsername, setReportUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

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
      setSubmitting(true);
      try {
        let scheduledAt: string | null = null;
        if (date && time) {
          const [h, m] = time.split(':').map(Number);
          let hour = h;
          if (amPm === 'PM' && hour < 12) hour += 12;
          if (amPm === 'AM' && hour === 12) hour = 0;
          scheduledAt = new Date(date).toISOString();
          scheduledAt = new Date(new Date(date).setHours(hour, m || 0, 0, 0)).toISOString();
        }
        const result = await onCreate({
          title: trimmedTitle,
          description: description.trim() || null,
          max_participants: maxParticipants,
          type,
          scheduled_at: scheduledAt,
          duration_minutes: durationMinutes,
          settings: { chat_permission: chatPermission },
        });
        setCreatedInviteUrl(result.invite_url);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to create huddle');
      } finally {
        setSubmitting(false);
      }
    },
    [title, description, type, maxParticipants, date, time, amPm, durationMinutes, chatPermission, onCreate]
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
          <p className="dash-huddles-create-invite-label">Invite link</p>
          <div className="dash-huddles-create-invite-row">
            <input
              type="text"
              readOnly
              value={createdInviteUrl}
              className="dash-huddles-create-invite-input"
              aria-label="Invite URL"
            />
            <button
              type="button"
              className="dash-huddles-create-invite-copy"
              onClick={handleCopyInvite}
              aria-label="Copy invite link"
            >
              {copySuccess ? 'Copied!' : 'Copy'}
            </button>
          </div>
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
            </div>
            <div className="dash-huddles-create-card">
              <h3 className="dash-huddles-create-card-title">Invite to huddle</h3>
              <p className="dash-huddles-create-hint">Link will appear after you schedule.</p>
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
                Time:
              </label>
              <div className="dash-huddles-create-time-row">
                <input
                  id="huddle-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="dash-huddles-create-input"
                />
                <div className="dash-huddles-create-options">
                  <button
                    type="button"
                    className={`dash-huddles-create-opt ${amPm === 'AM' ? 'dash-huddles-create-opt--on' : ''}`}
                    onClick={() => setAmPm('AM')}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    className={`dash-huddles-create-opt ${amPm === 'PM' ? 'dash-huddles-create-opt--on' : ''}`}
                    onClick={() => setAmPm('PM')}
                  >
                    PM
                  </button>
                </div>
              </div>
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
            <div className="dash-huddles-create-card">
              <h3 className="dash-huddles-create-card-title">Admin permissions</h3>
              <label className="dash-huddles-create-label">Chat:</label>
              <div className="dash-huddles-create-options">
                <button
                  type="button"
                  className={`dash-huddles-create-opt ${chatPermission === 'view_only' ? 'dash-huddles-create-opt--on' : ''}`}
                  onClick={() => setChatPermission('view_only')}
                >
                  View only
                </button>
                <button
                  type="button"
                  className={`dash-huddles-create-opt ${chatPermission === 'allow' ? 'dash-huddles-create-opt--on' : ''}`}
                  onClick={() => setChatPermission('allow')}
                >
                  Allow
                </button>
              </div>
              <label className="dash-huddles-create-label">Report:</label>
              <div className="dash-huddles-create-report-row">
                <input
                  type="text"
                  placeholder="@username"
                  value={reportUsername}
                  onChange={(e) => setReportUsername(e.target.value)}
                  className="dash-huddles-create-input"
                />
                <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--secondary">
                  Report
                </button>
              </div>
            </div>
            <div className="dash-huddles-create-card dash-huddles-create-card--stats">
              <h3 className="dash-huddles-create-card-title">Statistics</h3>
              <p className="dash-huddles-create-stat">Total public clicks: 0</p>
              <p className="dash-huddles-create-stat">Pre booked: 0 / {maxParticipants}</p>
              <p className="dash-huddles-create-stat">Available huddle seats: {maxParticipants} / {maxParticipants}</p>
              <p className="dash-huddles-create-stat">Traction: Level I, Level II, Level III</p>
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
