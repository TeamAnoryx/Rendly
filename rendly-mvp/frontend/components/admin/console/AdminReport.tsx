'use client';

/**
 * Monthly and quarterly reports for due diligence and audit. The report is a structured,
 * print-ready page (logos, period, generated time, KPIs, charts, feature usage, support,
 * security and system health); "Download PDF" uses the browser's Save as PDF.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnoryxSignature, RendlyLockup } from '@/components/brand/Brand';
import { adminFetch, tz, type Report } from '@/lib/adminApi';
import { AreaChart, BarChart, RankList } from './charts';
import { change, duration, hourLabel, num, pct, WEEKDAYS } from './format';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const plural = (n: number | null | undefined, word: string) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ChangeCell({ cur, prev }: { cur: number; prev: number }) {
  const d = change(cur, prev);
  if (d === null) return <td>new</td>;
  return <td className={d >= 0 ? 'rp-up' : 'rp-down'}>{d >= 0 ? '+' : ''}{Math.round(d * 100)}%</td>;
}

export default function AdminReport() {
  const now = useMemo(() => new Date(), []);
  const [kind, setKind] = useState<'month' | 'quarter'>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [index, setIndex] = useState(now.getMonth());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2], [now]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await adminFetch<Report>(`/api/admin/report?kind=${kind}&year=${year}&index=${index}&tz=${tz()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the report.');
    } finally {
      setLoading(false);
    }
  }, [kind, year, index]);

  useEffect(() => {
    void load();
  }, [load]);

  const d = report?.dashboard;
  const s = d?.summary;
  const p = d?.previous;
  const f = report?.features;
  const peakHour = d ? d.hourOfDay.indexOf(Math.max(...d.hourOfDay)) : -1;
  const peakDay = d ? d.dayOfWeek.indexOf(Math.max(...d.dayOfWeek)) : -1;
  const answered = report?.queries.answered ?? 0;
  const totalQueries = (report?.queries.open ?? 0) + answered + (report?.queries.closed ?? 0);

  return (
    <div className="adm-page ad-page">
      <header className="ad-head rp-controls">
        <div>
          <h1 className="ad-title">Reports</h1>
          <p className="ad-muted">Monthly and quarterly reports for due diligence and audit. Use Download PDF and choose “Save as PDF”.</p>
        </div>
        <div className="rp-pickers">
          <div className="seg" role="tablist" aria-label="Report type">
            <button role="tab" aria-selected={kind === 'month'} className="seg-btn" onClick={() => { setKind('month'); setIndex(now.getMonth()); }}>Monthly</button>
            <button role="tab" aria-selected={kind === 'quarter'} className="seg-btn" onClick={() => { setKind('quarter'); setIndex(Math.floor(now.getMonth() / 3)); }}>Quarterly</button>
          </div>
          <select className="ad-select" value={index} onChange={(e) => setIndex(Number(e.target.value))} aria-label="Period">
            {(kind === 'month' ? MONTHS : ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)']).map((label, i) => (
              <option key={label} value={i}>{label}</option>
            ))}
          </select>
          <select className="ad-select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="ad-btn ad-btn--primary" onClick={() => window.print()} disabled={!report || loading}>Download PDF</button>
        </div>
      </header>

      {error && <p className="ad-error" role="alert">{error}</p>}
      {loading && !report && <div className="skel-block" style={{ height: 480 }} />}

      {report && d && s && p && f && (
        <article className={`rp-doc ${loading ? 'is-loading' : ''}`}>
          <header className="rp-top">
            <RendlyLockup className="rp-logo" />
            <div className="rp-top-meta">
              <span className="rp-kind">{report.kind === 'month' ? 'Monthly report' : 'Quarterly report'}</span>
              <h2 className="rp-title">{report.label}</h2>
              <span className="rp-small">
                {new Date(report.from).toLocaleDateString('en-GB')} – {new Date(new Date(report.to).getTime() - 1).toLocaleDateString('en-GB')}
                {' · '}Generated {new Date(report.generatedAt).toLocaleString('en-GB')}
              </span>
            </div>
          </header>

          <section className="rp-section">
            <h3>1. Summary</h3>
            <p>
              Rendly had <b>{num(s.visitors)}</b> visitors and <b>{num(s.pageviews)}</b> page views in {report.label}, with{' '}
              <b>{num(s.signins)}</b> sign-ins and <b>{num(s.signups)}</b> new sign-ups. The platform has <b>{plural(f.totalUsers, 'registered user')}</b> ({num(f.newUsers)} joined in this period). Monthly active users: <b>{num(d.activeUsers.monthly)}</b>. Traffic peaked at{' '}
              <b>{peakHour >= 0 ? hourLabel(peakHour) : '—'}</b> and on <b>{peakDay >= 0 ? DAY_NAMES[peakDay] : '—'}</b>s.
            </p>
          </section>

          <section className="rp-section">
            <h3>2. Key metrics</h3>
            <table className="rp-table">
              <thead><tr><th>Metric</th><th>This period</th><th>Previous period</th><th>Change</th></tr></thead>
              <tbody>
                {[
                  ['Visitors', s.visitors, p.visitors],
                  ['Sessions', s.sessions, p.sessions],
                  ['Page views', s.pageviews, p.pageviews],
                  ['App opens', s.appOpens, p.appOpens],
                  ['Sign-ins', s.signins, p.signins],
                  ['New sign-ups', s.signups, p.signups],
                  ['Signed-in users', s.activeUsers, p.activeUsers],
                ].map(([label, cur, prev]) => (
                  <tr key={label as string}>
                    <td>{label}</td>
                    <td>{num(cur as number)}</td>
                    <td>{num(prev as number)}</td>
                    <ChangeCell cur={cur as number} prev={prev as number} />
                  </tr>
                ))}
                <tr><td>Watch time</td><td>{duration(s.watchTimeMs)}</td><td>{duration(p.watchTimeMs)}</td><ChangeCell cur={s.watchTimeMs} prev={p.watchTimeMs} /></tr>
                <tr><td>Average visit</td><td>{duration(s.avgSessionMs)}</td><td>{duration(p.avgSessionMs)}</td><ChangeCell cur={s.avgSessionMs} prev={p.avgSessionMs} /></tr>
                <tr><td>Bounce rate</td><td>{pct(s.bounceRate)}</td><td>{pct(p.bounceRate)}</td><td /></tr>
                <tr><td>Returning visitors</td><td>{pct(s.returningRate)}</td><td>{pct(p.returningRate)}</td><td /></tr>
              </tbody>
            </table>
          </section>

          <section className="rp-section rp-break">
            <h3>3. Traffic</h3>
            <AreaChart
              height={200}
              points={d.series.map((pt) => ({ label: new Date(pt.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), values: [pt.visitors, pt.pageviews] }))}
              series={[{ name: 'Visitors', color: '#6b7cff' }, { name: 'Page views', color: '#d0569e' }]}
            />
            <div className="rp-two">
              <div>
                <h4>By hour of day</h4>
                <BarChart values={d.hourOfDay} labels={Array.from({ length: 24 }, (_, h) => (h % 4 === 0 ? hourLabel(h) : ''))} highlight={peakHour} height={110} ariaLabel="Visitors by hour" />
              </div>
              <div>
                <h4>By weekday</h4>
                <BarChart values={d.dayOfWeek} labels={WEEKDAYS} highlight={peakDay} height={110} ariaLabel="Visitors by weekday" />
              </div>
            </div>
            <p className="rp-small">
              Daily / weekly / monthly active users: {num(d.activeUsers.daily)} / {num(d.activeUsers.weekly)} / {num(d.activeUsers.monthly)}.
              Busiest date: {d.peak.day ?? '—'}. Quietest date: {d.lowest.day ?? '—'}.
            </p>
          </section>

          <section className="rp-section">
            <h3>4. Feature usage</h3>
            <table className="rp-table">
              <thead><tr><th>Feature</th><th>Activity</th><th>Users</th><th>Repeat users</th></tr></thead>
              <tbody>
                <tr><td>Whispers (1:1 chat)</td><td>{num(f.whispers.messages)} messages</td><td>{num(f.whispers.users)}</td><td>{pct(f.whispers.repeatRate)}</td></tr>
                <tr><td>Group chats</td><td>{num(f.groups.messages)} messages</td><td>—</td><td>—</td></tr>
                <tr><td>Huddles</td><td>{num(f.huddles.created)} created</td><td>{num(f.huddles.users)}</td><td>{pct(f.huddles.repeatRate)}</td></tr>
                <tr><td>Spark matching</td><td>{num(f.spark.searches)} searches, {num(f.spark.matched)} matched</td><td>{num(f.spark.users)}</td><td>{pct(f.spark.repeatRate)}</td></tr>
              </tbody>
            </table>
          </section>

          <section className="rp-section">
            <h3>5. Audience</h3>
            <div className="rp-two">
              <div><h4>Top countries</h4><RankList rows={d.countries.slice(0, 8).map((r) => ({ label: r.key, value: r.count }))} /></div>
              <div><h4>Top pages</h4><RankList rows={d.pages.slice(0, 8).map((r) => ({ label: r.path, value: r.views }))} /></div>
            </div>
            <div className="rp-two">
              <div><h4>Devices</h4><RankList rows={d.devices.map((r) => ({ label: r.key, value: r.count }))} /></div>
              <div><h4>Sources</h4><RankList rows={d.referrers.slice(0, 6).map((r) => ({ label: r.key, value: r.count }))} empty="Mostly direct visits" /></div>
            </div>
          </section>

          <section className="rp-section rp-break">
            <h3>6. Support</h3>
            <p>
              {num(totalQueries)} user queries received: {num(report.queries.open)} open, {num(answered)} answered, {num(report.queries.closed)} closed
              {totalQueries ? ` (${pct((answered + (report.queries.closed ?? 0)) / totalQueries)} resolved)` : ''}.
            </p>
          </section>

          <section className="rp-section">
            <h3>7. Security</h3>
            <p>
              {report.security.bySeverity.critical} critical, {report.security.bySeverity.warning} warning and {report.security.bySeverity.info} informational
              security events were recorded. Critical events trigger an immediate email alert.
            </p>
            {report.security.byKind.length > 0 && (
              <table className="rp-table">
                <thead><tr><th>Event type</th><th>Count</th></tr></thead>
                <tbody>
                  {report.security.byKind.map((k) => {
                    const row = k as { kind?: string; key?: string; count: number };
                    return <tr key={row.kind ?? row.key}><td>{row.kind ?? row.key}</td><td>{num(row.count)}</td></tr>;
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="rp-section">
            <h3>8. System health at generation time</h3>
            <table className="rp-table">
              <thead><tr><th>Service</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {report.health.services.map((sv) => (
                  <tr key={sv.name}><td>{sv.name}</td><td className={sv.ok ? 'rp-up' : 'rp-down'}>{sv.ok ? 'Working' : 'Down'}</td><td>{sv.ok ? `${sv.latencyMs} ms` : sv.detail}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <footer className="rp-foot">
            <AnoryxSignature />
            <span className="rp-small">
              Confidential. Figures come from Rendly&apos;s first-party analytics (no cookies; visitors with Do Not Track are not counted) and its production database.
            </span>
          </footer>
        </article>
      )}
    </div>
  );
}
