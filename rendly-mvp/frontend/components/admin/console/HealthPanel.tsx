'use client';

/** Service health, request stats for the last 5 minutes, and recent security events. */
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, type Health } from '@/lib/adminApi';
import { num, when } from './format';

const REFRESH_MS = 30_000;

const KIND_LABEL: Record<string, string> = {
  probe: 'Scanner probe',
  error_spike: 'Server error spike',
  rate_limit_flood: 'Rate-limit flood',
  auth_failure_burst: 'Repeated failed sign-ins',
  admin_login_failed: 'Admin sign-in failed',
  admin_login_lockout: 'Admin sign-in locked out',
  admin_bruteforce: 'Admin sign-in attack',
  admin_login: 'Admin signed in',
  traffic_peak: 'Traffic peak',
};

export default function HealthPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHealth(await adminFetch<Health>('/api/admin/health'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load health.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const allOk = health?.services.every((s) => s.ok);
  const r = health?.requests;
  const sev = health?.security.bySeverity;

  return (
    <div className="adm-page ad-page">
      <header className="ad-head">
        <div>
          <p className="ad-eyebrow">
            <span className={`status-dot ${health ? (allOk ? 'is-ok' : 'is-bad') : ''}`} aria-hidden />
            {health ? (allOk ? 'All systems working' : 'Something needs attention') : 'Checking…'}
          </p>
          <h1 className="ad-title">Health and security</h1>
          <p className="ad-muted">Refreshes every 30 seconds. Critical events are emailed to the admin alert address.</p>
        </div>
        <button className="ad-btn" onClick={() => void load()}>Check now</button>
      </header>
      {error && <p className="ad-error" role="alert">{error}</p>}

      <div className="svc-grid">
        {(health?.services ?? []).map((s, i) => (
          <div key={s.name} className={`svc ${s.ok ? 'is-ok' : 'is-bad'}`} style={{ animationDelay: `${i * 50}ms` }}>
            <span className={`status-dot ${s.ok ? 'is-ok' : 'is-bad'}`} aria-hidden />
            <div>
              <b>{s.name}</b>
              <span>{s.ok ? `Working · ${s.latencyMs} ms` : s.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="kpi-grid">
        <div className="kpi"><span className="kpi-label">Requests (5 min)</span><span className="kpi-value">{num(r?.requests)}</span></div>
        <div className="kpi"><span className="kpi-label">Server errors</span><span className={`kpi-value ${r && r.errors5xx > 0 ? 'is-bad' : ''}`}>{num(r?.errors5xx)}</span></div>
        <div className="kpi"><span className="kpi-label">Failed sign-ins</span><span className="kpi-value">{num(r?.authFailures)}</span></div>
        <div className="kpi"><span className="kpi-label">Rate limited</span><span className="kpi-value">{num(r?.rateLimited)}</span></div>
        <div className="kpi"><span className="kpi-label">Avg. latency</span><span className="kpi-value">{r ? `${r.avgLatencyMs} ms` : '—'}</span></div>
        <div className="kpi"><span className="kpi-label">p95 latency</span><span className="kpi-value">{r ? `${r.p95LatencyMs} ms` : '—'}</span></div>
      </div>

      <section className="ad-card">
        <div className="ad-card-head">
          <h2 className="ad-h2">Security events, last 7 days</h2>
          <span className="sev-pills">
            <span className="sev sev--critical">{sev?.critical ?? 0} critical</span>
            <span className="sev sev--warning">{sev?.warning ?? 0} warning</span>
            <span className="sev sev--info">{sev?.info ?? 0} info</span>
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>When</th><th>Severity</th><th>Event</th><th>Detail</th><th>Path</th><th>Emailed</th></tr>
            </thead>
            <tbody>
              {(health?.security.events ?? []).map((e, i) => (
                <tr key={`${e.created_at}-${i}`} style={{ animationDelay: `${i * 20}ms` }}>
                  <td>{when(e.created_at)}</td>
                  <td><span className={`sev sev--${e.severity}`}>{e.severity}</span></td>
                  <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td className="tbl-detail">{e.detail}</td>
                  <td className="tbl-path">{e.path ?? ''}</td>
                  <td>{e.alerted ? 'Yes' : ''}</td>
                </tr>
              ))}
              {health && health.security.events.length === 0 && (
                <tr><td colSpan={6} className="ac-empty">No security events. All quiet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
