'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/shell/Icon';
import { normaliseIntent } from '@/components/huddles/HuddleCreate';
import './huddle-search.css';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HINTS = ['Search by #intent, like #ai', 'Paste a huddle link to jump straight in', 'Try #design or #hackathon'];
const HINT_MS = 3200;
const MAX_SUGGESTIONS = 6;

export interface HuddleSearchProps {
  /** Intent currently applied to the board, or null. */
  intent: string | null;
  onIntent: (intent: string | null) => void;
  /** Intent tags on loaded huddles, offered as suggestions. */
  knownIntents: string[];
  className?: string;
}

/** A huddle link or bare id gives its id; anything else gives null. */
export function huddleIdFrom(text: string): string | null {
  const match = text.match(UUID);
  return match ? match[0].toLowerCase() : null;
}

export default function HuddleSearch({ intent, onIntent, knownIntents, className }: HuddleSearchProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [hint, setHint] = useState(0);

  // Rotating placeholder while the field is idle.
  useEffect(() => {
    if (focused || value) return;
    const t = setInterval(() => setHint((i) => (i + 1) % HINTS.length), HINT_MS);
    return () => clearInterval(t);
  }, [focused, value]);

  // "/" focuses the search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== '/' || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const linkId = huddleIdFrom(value);
  const query = normaliseIntent(value);
  const suggestions = useMemo(() => {
    if (linkId) return [];
    const q = query.toLowerCase();
    return knownIntents.filter((t) => t !== intent && (!q || t.includes(q))).slice(0, MAX_SUGGESTIONS);
  }, [knownIntents, query, linkId, intent]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (linkId) {
      router.push(`/dashboard/huddles/${encodeURIComponent(linkId)}`);
      return;
    }
    onIntent(query || null);
    setValue('');
    inputRef.current?.blur();
  };

  const pick = (tag: string) => {
    onIntent(tag);
    setValue('');
    inputRef.current?.blur();
  };

  return (
    <div className={`hs ${focused ? 'hs--focus' : ''} ${className ?? ''}`}>
      <form className="hs-field" role="search" onSubmit={submit}>
        <span className="hs-icon" aria-hidden>
          <Icon name={linkId ? 'arrow-right' : 'search'} size={16} />
        </span>
        <input
          ref={inputRef}
          className="hs-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Search huddles by intent, or paste a huddle link"
          autoComplete="off"
          spellCheck={false}
        />
        {!value ? (
          <span key={hint} className="hs-hint" aria-hidden>
            {HINTS[hint]}
          </span>
        ) : null}
        {intent ? (
          <button type="button" className="hs-active" onClick={() => onIntent(null)} aria-label={`Clear filter #${intent}`}>
            #{intent} <Icon name="close" size={11} />
          </button>
        ) : null}
        <span className="hs-kbd" aria-hidden>
          {linkId ? 'Enter to open' : value ? 'Enter' : '/'}
        </span>
      </form>
      {focused && suggestions.length ? (
        <ul className="hs-pop" aria-label="Intent suggestions">
          {suggestions.map((t, i) => (
            <li key={t} style={{ animationDelay: `${i * 30}ms` }}>
              <button type="button" className="hs-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t)}>
                <span className="hs-hash">#</span>
                {t}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
