'use client';

/**
 * Contact form: questions, feedback and bug reports go to auth-service /api/contact and appear in
 * the admin console's query inbox. Signed-in users also get the admin's reply in their
 * notifications and in the Rendly Team Whisper.
 */
import { useState, type FormEvent } from 'react';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { getStoredAuthToken } from '@/lib/auth-storage';
import SiteShell from '@/components/landing/SiteShell';
import './contact.css';

const CATEGORIES = [
  { value: 'query', label: 'A question' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'bug', label: 'Something is broken' },
  { value: 'other', label: 'Something else' },
] as const;

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<string>('query');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !EMAIL_RE.test(email.trim()) || message.trim().length < 5) {
      setStatus({ kind: 'error', message: 'Add your name, a valid email and a message of at least 5 characters.' });
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      const base = await getResolvedApiUrl();
      const token = getStoredAuthToken();
      const res = await fetch(`${base}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), category, subject: subject.trim(), message: message.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'We could not send your message. Try again in a moment.');
      }
      setStatus({ kind: 'sent' });
      setSubject('');
      setMessage('');
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'We could not send your message.' });
    }
  }

  return (
    <SiteShell>
    <article className="ld-legal ct-page">
      <header className="ld-legal-head">
        <p className="ld-eyebrow">Contact</p>
        <h1 className="ld-legal-title">Talk to the Rendly team</h1>
        <p className="ct-lede">
          Questions, feedback or something not working? Send it here and a real person replies. If you are signed in,
          the reply also lands in your notifications and in your Rendly Team chat.
        </p>
      </header>

      {status.kind === 'sent' ? (
        <div className="ct-done" role="status">
          <h2>Thanks, we have your message.</h2>
          <p>We usually reply within one working day.</p>
          <button type="button" className="ct-btn" onClick={() => setStatus({ kind: 'idle' })}>
            Send another message
          </button>
        </div>
      ) : (
        <form className="ct-form" onSubmit={onSubmit} noValidate>
          <div className="ct-row">
            <label className="ct-field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" required />
            </label>
            <label className="ct-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" required />
            </label>
          </div>
          <div className="ct-row">
            <label className="ct-field">
              <span>What is it about?</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="ct-field">
              <span>Subject <em>(optional)</em></span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
            </label>
          </div>
          <label className="ct-field">
            <span>Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} maxLength={5000} required />
          </label>
          {status.kind === 'error' && <p className="ct-error" role="alert">{status.message}</p>}
          <button type="submit" className="ct-btn" disabled={status.kind === 'sending'}>
            {status.kind === 'sending' ? 'Sending…' : 'Send message'}
          </button>
        </form>
      )}
    </article>
    </SiteShell>
  );
}
