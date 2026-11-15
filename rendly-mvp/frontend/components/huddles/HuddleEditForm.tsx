'use client';

import React, { useState } from 'react';
import { updateHuddle, type HuddleDetail, type HuddleEditPatch } from '@/services/huddlesApi';
import { Icon } from '@/components/shell/Icon';
import './huddle-edit.css';

const MAX_INTENTS = 5;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;
const DESCRIPTION_MAX = 2000;
const DURATION_MIN = 1;
const DURATION_MAX = 30;

/** "#Design Systems" -> "design-systems"; returns null when it cannot be a valid tag. */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return TAG_PATTERN.test(tag) ? tag : null;
}

/** ISO timestamp -> value for <input type="datetime-local"> in the viewer's own time zone. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface HuddleEditFormProps {
  huddle: HuddleDetail;
  onSaved: (rescheduled: boolean) => void;
  onClose: () => void;
}

export default function HuddleEditForm({ huddle, onSaved, onClose }: HuddleEditFormProps) {
  const started = Boolean(huddle.started_at);
  const [description, setDescription] = useState(huddle.description ?? '');
  const [tags, setTags] = useState<string[]>(huddle.intents ?? []);
  const [tagInput, setTagInput] = useState('');
  const [when, setWhen] = useState(toLocalInput(huddle.scheduled_at));
  const [duration, setDuration] = useState(huddle.duration_minutes != null ? String(huddle.duration_minutes) : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addTag = () => {
    if (!tagInput.trim()) return;
    const tag = normalizeTag(tagInput);
    if (!tag) {
      setErr('Intents use letters, numbers and dashes (up to 30).');
      return;
    }
    if (tags.length >= MAX_INTENTS) {
      setErr(`Up to ${MAX_INTENTS} intents.`);
      return;
    }
    setErr(null);
    setTags((t) => (t.includes(tag) ? t : [...t, tag]));
    setTagInput('');
  };

  const buildPatch = (): HuddleEditPatch | string => {
    const patch: HuddleEditPatch = {};
    const desc = description.trim();
    if (desc !== (huddle.description ?? '')) patch.description = desc || null;
    const before = huddle.intents ?? [];
    if (tags.length !== before.length || tags.some((t, i) => t !== before[i])) patch.intents = tags;
    if (!started) {
      if (when !== toLocalInput(huddle.scheduled_at)) {
        if (!when) patch.scheduled_at = null;
        else {
          const ms = new Date(when).getTime();
          if (Number.isNaN(ms)) return 'Pick a valid date and time.';
          if (ms < Date.now() - 60_000) return 'Pick a time in the future.';
          patch.scheduled_at = new Date(ms).toISOString();
        }
      }
      const mins = duration === '' ? null : Number(duration);
      if (mins !== null && (!Number.isInteger(mins) || mins < DURATION_MIN || mins > DURATION_MAX)) {
        return `Length is ${DURATION_MIN} to ${DURATION_MAX} minutes.`;
      }
      if (mins !== (huddle.duration_minutes ?? null)) patch.duration_minutes = mins;
    }
    return patch;
  };

  const save = async () => {
    const patch = buildPatch();
    if (typeof patch === 'string') {
      setErr(patch);
      return;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await updateHuddle(huddle.id, patch);
      onSaved(patch.scheduled_at !== undefined || patch.duration_minutes !== undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="he" role="group" aria-label="Edit huddle">
      <label className="he-field">
        <span className="he-label">Description</span>
        <textarea
          className="he-input he-textarea"
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={3}
          placeholder="What is this huddle about?"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="he-field">
        <span className="he-label">
          Intents <em>{tags.length}/{MAX_INTENTS}</em>
        </span>
        <div className="he-tags">
          {tags.map((t) => (
            <span key={t} className="he-tag">
              #{t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags((x) => x.filter((y) => y !== t))}>
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
          {tags.length < MAX_INTENTS ? (
            <input
              className="he-tag-input"
              value={tagInput}
              placeholder="#add-intent"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
          ) : null}
        </div>
      </div>

      <div className="he-row">
        <label className="he-field">
          <span className="he-label">Date and time</span>
          <input type="datetime-local" className="he-input" value={when} disabled={started} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="he-field he-field--short">
          <span className="he-label">Length (min)</span>
          <input
            type="number"
            className="he-input"
            min={DURATION_MIN}
            max={DURATION_MAX}
            value={duration}
            disabled={started}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
      </div>
      {started ? (
        <p className="he-note">The huddle has started, so its time can no longer change.</p>
      ) : huddle.scheduled_at ? (
        <p className="he-note">Changing the time marks the huddle as rescheduled and tells everyone invited.</p>
      ) : null}

      {err ? <p className="he-err">{err}</p> : null}
      <div className="he-actions">
        <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" disabled={saving} onClick={save}>
          {saving ? <span className="rd-spinner" /> : <Icon name="check" size={14} />} Save changes
        </button>
        <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" disabled={saving} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
