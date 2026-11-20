'use client';

/**
 * "User active queries": messages from the Contact page and from users' Rendly Team chat.
 * A reply goes to the user's Rendly Team chat and notifications (or by email for guests).
 */
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, type Query, type QueryCounts } from '@/lib/adminApi';
import { when } from './format';

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'answered', label: 'Answered' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
] as const;

const SOURCE_LABEL: Record<string, string> = { contact_page: 'Contact page', whispers: 'Rendly Team chat' };

interface QueriesInboxProps {
  compact?: boolean;
}

export default function QueriesInbox({ compact = false }: QueriesInboxProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('open');
  const [queries, setQueries] = useState<Query[]>([]);
  const [counts, setCounts] = useState<QueryCounts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<{ queries: Query[]; counts: QueryCounts }>(`/api/admin/queries?status=${tab}`);
      setQueries(res.queries);
      setCounts(res.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load queries.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reply(q: Query) {
    if (!draft.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await adminFetch<{ deliveredInApp: boolean; emailed: boolean }>(`/api/admin/queries/${q.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply: draft.trim() }),
      });
      setNotice(res.deliveredInApp ? 'Reply sent to their Rendly Team chat and notifications.' : res.emailed ? 'Reply emailed.' : 'Reply saved.');
      setDraft('');
      setOpenId(null);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  }

  async function setStatus(q: Query, status: Query['status']) {
    try {
      await adminFetch(`/api/admin/queries/${q.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update the query.');
    }
  }

  return (
    <section className="qi-wrap">
      <div className="qi-head">
        <div>
          <h2 className="ad-h2">User active queries</h2>
          {!compact && <p className="ad-muted">Questions and feedback from the Contact page and the Rendly Team chat.</p>}
        </div>
        <div className="seg" role="tablist" aria-label="Query status">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className="seg-btn" onClick={() => setTab(t.key)}>
              {t.label}
              {t.key !== 'all' && counts[t.key] !== undefined && counts[t.key] !== null ? <span className="seg-count">{counts[t.key]}</span> : null}
            </button>
          ))}
        </div>
      </div>
      {notice && <p className="qi-notice" role="status">{notice}</p>}
      {error && <p className="ad-error" role="alert">{error}</p>}
      {loading ? (
        <div className="qi-skel" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skel-row" />)}
        </div>
      ) : queries.length === 0 ? (
        <p className="ac-empty">{tab === 'open' ? 'No open queries. Nice.' : 'Nothing here.'}</p>
      ) : (
        <ul className="qi-list">
          {queries.slice(0, compact ? 8 : 200).map((q) => {
            const isOpen = openId === q.id;
            return (
              <li key={q.id} className={`qi-item ${isOpen ? 'is-open' : ''}`}>
                <button className="qi-row" onClick={() => { setOpenId(isOpen ? null : q.id); setDraft(''); }} aria-expanded={isOpen}>
                  <span className={`qi-dot qi-dot--${q.status}`} aria-hidden />
                  <span className="qi-who">
                    <b>{q.name}</b>
                    <span>{q.email || 'no email'}</span>
                  </span>
                  <span className="qi-subject">{q.subject || q.message.slice(0, 90)}</span>
                  <span className={`qi-chip qi-chip--${q.category ?? 'query'}`}>{q.category ?? 'query'}</span>
                  <span className="qi-src">{SOURCE_LABEL[q.source ?? ''] ?? q.source ?? 'Contact page'}</span>
                  <span className="qi-when">{when(q.created_at)}</span>
                </button>
                {isOpen && (
                  <div className="qi-detail">
                    <p className="qi-message">{q.message}</p>
                    {q.reply && (
                      <div className="qi-reply-prev">
                        <span>Replied {q.replied_at ? when(q.replied_at) : ''}</span>
                        <p>{q.reply}</p>
                      </div>
                    )}
                    <textarea
                      className="qi-textarea"
                      placeholder={q.user_id ? 'Reply in their Rendly Team chat…' : 'Reply by email…'}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      maxLength={4000}
                    />
                    <div className="qi-actions">
                      <button className="ad-btn ad-btn--primary" disabled={sending || !draft.trim()} onClick={() => void reply(q)}>
                        {sending ? 'Sending…' : 'Send reply'}
                      </button>
                      {q.status !== 'closed' && <button className="ad-btn" onClick={() => void setStatus(q, 'closed')}>Close</button>}
                      {q.status !== 'open' && <button className="ad-btn" onClick={() => void setStatus(q, 'open')}>Reopen</button>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
