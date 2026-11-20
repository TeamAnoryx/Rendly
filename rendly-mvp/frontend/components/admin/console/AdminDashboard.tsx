'use client';

/**
 * Analytics overview: KPIs with change versus the previous period, traffic over time, busiest
 * and quietest hours and weekdays, a visitor map, top pages, sources, locations and devices,
 * active users, and feature usage (Whispers, Huddles, Spark). The query inbox sits below.
 */
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { adminFetch, tz, type Features, type Overview, type RangeName } from '@/lib/adminApi';
import { AreaChart, BarChart, Donut, RankList } from './charts';
import { change, duration, hourLabel, num, pct, WEEKDAYS } from './format';
import QueriesInbox from './QueriesInbox';

const CityMap = dynamic(() => import('./CityMap'), { ssr: false, loading: () => <div className="cm-wrap skel-block" /> });

const RANGES: { key: RangeName; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'quarter', label: '3 months' },
];

const COLORS = ['#8ea2ff', '#f08bd0', '#7ee0b5', '#ffc56b', '#b78bff', '#6bd3ff'];
const REFRESH_MS = 60_000;

type Breakdown = 'countries' | 'cities' | 'devices' | 'browsers' | 'os';

function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  const d = change(cur, prev);
  if (d === null) return <span className="kpi-delta kpi-delta--new">new</span>;
  if (Math.abs(d) < 0.005) return <span className="kpi-delta">0%</span>;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={`kpi-delta ${good ? 'kpi-delta--up' : 'kpi-delta--down'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(Math.round(d * 100))}%
    </span>
  );
}

function seriesLabel(t: string, range: RangeName): string {
  const d = new Date(t);
  if (range === 'day') return hourLabel(d.getHours());
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function AdminDashboard() {
  const [range, setRange] = useState<RangeName>('week');
  const [data, setData] = useState<Overview | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [breakdown, setBreakdown] = useState<Breakdown>('countries');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const [overview, feats] = await Promise.all([
          adminFetch<Overview>(`/api/admin/overview?range=${range}&tz=${tz()}`),
          adminFetch<Features>(`/api/admin/features?range=${range}`),
        ]);
        setData(overview);
        setFeatures(feats);
        setUpdatedAt(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load analytics.');
      } finally {
        setLoading(false);
      }
    },
    [range],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const s = data?.summary;
  const p = data?.previous;
  const peakHour = data ? data.hourOfDay.indexOf(Math.max(...data.hourOfDay)) : -1;
  const lowHour = data ? data.hourOfDay.indexOf(Math.min(...data.hourOfDay)) : -1;
  const peakDay = data ? data.dayOfWeek.indexOf(Math.max(...data.dayOfWeek)) : -1;
  const lowDay = data ? data.dayOfWeek.indexOf(Math.min(...data.dayOfWeek)) : -1;

  const breakdownRows = (): { label: string; value: number; sub?: string }[] => {
    if (!data) return [];
    if (breakdown === 'cities') return data.cities.map((c) => ({ label: c.key, value: c.count, sub: c.country ?? undefined }));
    return data[breakdown].map((r) => ({ label: r.key, value: r.count }));
  };

  return (
    <div className="adm-page ad-page">
      <header className="ad-head">
        <div>
          <p className="ad-eyebrow">
            <span className="live-dot" aria-hidden /> {num(data?.liveVisitors ?? 0)} live now
          </p>
          <h1 className="ad-title">Overview</h1>
          <p className="ad-muted">
            {updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, refreshes every minute.` : 'Loading…'}
            {data?.truncated ? ' Showing the most recent 250,000 events.' : ''}
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.key} role="tab" aria-selected={range === r.key} className="seg-btn" onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="ad-error" role="alert">
          {error} <button className="ad-btn" onClick={() => void load()}>Retry</button>
        </div>
      )}

      <div className={`kpi-grid ${loading ? 'is-loading' : ''}`}>
        {[
          { label: 'Visitors', v: s?.visitors, pv: p?.visitors },
          { label: 'Page views', v: s?.pageviews, pv: p?.pageviews },
          { label: 'App opens', v: s?.appOpens, pv: p?.appOpens },
          { label: 'Sign-ins', v: s?.signins, pv: p?.signins },
          { label: 'New sign-ups', v: s?.signups, pv: p?.signups },
          { label: 'Signed-in users', v: s?.activeUsers, pv: p?.activeUsers },
        ].map((k, i) => (
          <div key={k.label} className="kpi" style={{ animationDelay: `${i * 40}ms` }}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">{num(k.v ?? 0)}</span>
            {s && p ? <Delta cur={k.v ?? 0} prev={k.pv ?? 0} /> : <span className="kpi-delta">—</span>}
          </div>
        ))}
        <div className="kpi">
          <span className="kpi-label">Watch time</span>
          <span className="kpi-value">{duration(s?.watchTimeMs)}</span>
          {s && p ? <Delta cur={s.watchTimeMs} prev={p.watchTimeMs} /> : null}
        </div>
        <div className="kpi">
          <span className="kpi-label">Avg. visit</span>
          <span className="kpi-value">{duration(s?.avgSessionMs)}</span>
          {s && p ? <Delta cur={s.avgSessionMs} prev={p.avgSessionMs} /> : null}
        </div>
        <div className="kpi">
          <span className="kpi-label">Bounce rate</span>
          <span className="kpi-value">{pct(s?.bounceRate)}</span>
          {s && p ? <Delta cur={s.bounceRate} prev={p.bounceRate} invert /> : null}
        </div>
        <div className="kpi">
          <span className="kpi-label">Returning visitors</span>
          <span className="kpi-value">{pct(s?.returningRate)}</span>
          {s && p ? <Delta cur={s.returningRate} prev={p.returningRate} /> : null}
        </div>
      </div>

      <section className="ad-card">
        <div className="ad-card-head">
          <h2 className="ad-h2">Traffic</h2>
          <span className="ad-muted">Visitors, page views and sign-ins per {range === 'day' ? 'hour' : 'day'}</span>
        </div>
        {data ? (
          <AreaChart
            points={data.series.map((pt) => ({ label: seriesLabel(pt.t, range), values: [pt.visitors, pt.pageviews, pt.signins] }))}
            series={[
              { name: 'Visitors', color: COLORS[0] },
              { name: 'Page views', color: COLORS[1] },
              { name: 'Sign-ins', color: COLORS[2] },
            ]}
          />
        ) : (
          <div className="skel-block" style={{ height: 240 }} />
        )}
      </section>

      <div className="ad-grid-3">
        <section className="ad-card">
          <h2 className="ad-h2">Active users</h2>
          <div className="au-row">
            <div><span className="au-num">{num(data?.activeUsers.daily)}</span><span className="ad-muted">Daily</span></div>
            <div><span className="au-num">{num(data?.activeUsers.weekly)}</span><span className="ad-muted">Weekly</span></div>
            <div><span className="au-num">{num(data?.activeUsers.monthly)}</span><span className="ad-muted">Monthly</span></div>
          </div>
          <p className="ad-muted au-foot">
            Stickiness (DAU/MAU): {data && data.activeUsers.monthly ? pct(data.activeUsers.daily / data.activeUsers.monthly) : '—'}
          </p>
        </section>
        <section className="ad-card">
          <h2 className="ad-h2">Peak and quiet times</h2>
          <dl className="pk-list">
            <div><dt>Busiest hour</dt><dd className="pk-up">{peakHour >= 0 ? hourLabel(peakHour) : '—'}</dd></div>
            <div><dt>Quietest hour</dt><dd className="pk-down">{lowHour >= 0 ? hourLabel(lowHour) : '—'}</dd></div>
            <div><dt>Busiest weekday</dt><dd className="pk-up">{peakDay >= 0 ? WEEKDAYS[peakDay] : '—'}</dd></div>
            <div><dt>Quietest weekday</dt><dd className="pk-down">{lowDay >= 0 ? WEEKDAYS[lowDay] : '—'}</dd></div>
            <div><dt>Busiest date</dt><dd className="pk-up">{data?.peak.day ?? '—'}</dd></div>
            <div><dt>Quietest date</dt><dd className="pk-down">{data?.lowest.day ?? '—'}</dd></div>
          </dl>
        </section>
        <section className="ad-card">
          <h2 className="ad-h2">Devices</h2>
          <Donut parts={(data?.devices ?? []).slice(0, 4).map((d, i) => ({ label: d.key, value: d.count, color: COLORS[i] }))} />
        </section>
      </div>

      <div className="ad-grid-2">
        <section className="ad-card">
          <div className="ad-card-head">
            <h2 className="ad-h2">Visitors by hour of day</h2>
            <span className="ad-muted">Your local time</span>
          </div>
          <BarChart
            values={data?.hourOfDay ?? new Array(24).fill(0)}
            labels={Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? hourLabel(h) : ''))}
            highlight={peakHour}
            low={lowHour}
            ariaLabel="Visitors by hour of day"
          />
        </section>
        <section className="ad-card">
          <h2 className="ad-h2">Visitors by weekday</h2>
          <BarChart values={data?.dayOfWeek ?? new Array(7).fill(0)} labels={WEEKDAYS} highlight={peakDay} low={lowDay} ariaLabel="Visitors by weekday" />
        </section>
      </div>

      <section className="ad-card">
        <div className="ad-card-head">
          <h2 className="ad-h2">Where visitors are</h2>
          <span className="ad-muted">{num(data?.countries.length ?? 0)} countries · {num(data?.cities.length ?? 0)} cities</span>
        </div>
        <CityMap cities={data?.cities ?? []} />
      </section>

      <div className="ad-grid-2">
        <section className="ad-card">
          <h2 className="ad-h2">Top pages</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Page</th><th>Views</th><th>Visitors</th><th>Avg. time</th></tr>
              </thead>
              <tbody>
                {(data?.pages ?? []).slice(0, 12).map((pg, i) => (
                  <tr key={pg.path} style={{ animationDelay: `${i * 25}ms` }}>
                    <td className="tbl-path" title={pg.path}>{pg.path}</td>
                    <td>{num(pg.views)}</td>
                    <td>{num(pg.visitors)}</td>
                    <td>{duration(pg.avgTimeMs)}</td>
                  </tr>
                ))}
                {data && data.pages.length === 0 && <tr><td colSpan={4} className="ac-empty">No page views yet</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="ad-card">
          <div className="ad-card-head">
            <h2 className="ad-h2">Audience</h2>
            <select className="ad-select" value={breakdown} onChange={(e) => setBreakdown(e.target.value as Breakdown)} aria-label="Audience breakdown">
              <option value="countries">Countries</option>
              <option value="cities">Cities</option>
              <option value="devices">Devices</option>
              <option value="browsers">Browsers</option>
              <option value="os">Operating systems</option>
            </select>
          </div>
          <RankList rows={breakdownRows().slice(0, 10)} />
          <h3 className="ad-h3">Sources</h3>
          <RankList rows={(data?.referrers ?? []).slice(0, 6).map((r) => ({ label: r.key, value: r.count }))} empty="Mostly direct visits" />
        </section>
      </div>

      <section className="ad-card">
        <div className="ad-card-head">
          <h2 className="ad-h2">Feature usage</h2>
          <span className="ad-muted">
            {num(features?.totalUsers)} total users · {num(features?.newUsers)} new this period
          </span>
        </div>
        <div className="ft-grid">
          <div className="ft">
            <span className="ft-name">Whispers</span>
            <span className="ft-num">{num(features?.whispers.messages)}</span>
            <span className="ad-muted">messages from {num(features?.whispers.users)} users</span>
            <span className="ft-sub">Repeat users {pct(features?.whispers.repeatRate)}</span>
          </div>
          <div className="ft">
            <span className="ft-name">Group chats</span>
            <span className="ft-num">{num(features?.groups.messages)}</span>
            <span className="ad-muted">messages</span>
          </div>
          <div className="ft">
            <span className="ft-name">Huddles</span>
            <span className="ft-num">{num(features?.huddles.created)}</span>
            <span className="ad-muted">created by {num(features?.huddles.users)} hosts</span>
            <span className="ft-sub"><span className="live-dot" aria-hidden /> {num(features?.huddles.liveNow)} live now · repeat {pct(features?.huddles.repeatRate)}</span>
          </div>
          <div className="ft">
            <span className="ft-name">Spark</span>
            <span className="ft-num">{num(features?.spark.searches)}</span>
            <span className="ad-muted">searches, {num(features?.spark.matched)} matched</span>
            <span className="ft-sub">
              Match rate {features && features.spark.searches ? pct(features.spark.matched / features.spark.searches) : '—'} · repeat {pct(features?.spark.repeatRate)}
            </span>
          </div>
        </div>
      </section>

      <QueriesInbox compact />
    </div>
  );
}
