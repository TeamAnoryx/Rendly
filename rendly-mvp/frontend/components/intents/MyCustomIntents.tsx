'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import { Icon } from '@/components/shell/Icon';
import { TokenAmount, TokenCoin } from '@/components/brand/TokenCoin';
import { Avatar } from '@/components/shell/AppShell';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { useNotifications } from '@/context/NotificationsContext';
import { getMyPoints, emitPointsChanged, POINTS_CHANGED_EVENT } from '@/services/pointsApi';
import {
  clearMyLocation,
  getHotIntents,
  getLocationIntents,
  getMyIntents,
  getNearbyIntents,
  intentDaysLeft,
  intentPrice,
  intentPriceLabel,
  INTENT_PURCHASE_DAYS,
  purchaseIntent,
  removeMyIntent,
  searchIntents,
  setMyLocation,
  type Intent,
  type IntentSource,
  type MyIntent,
  type NearbyResult,
} from '@/services/intentsApi';
import IntentPickerDialog from './IntentPickerDialog';
import CreateIntentDialog from './CreateIntentDialog';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 5;
const HOT_LIMIT = 10;

type CategoryTab = 'hot' | 'location' | 'nearby';
type PendingPurchase = { intent: Intent; source: IntentSource };

export type MyCustomIntentsProps = {
  /** `full` adds the Hot / Location / Near By tabs; `compact` is chips + search + create only. */
  variant?: 'full' | 'compact';
  className?: string;
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function usageCount(intent: Intent): number {
  return intent.active_users ?? intent.usage_count ?? 0;
}

/** Balance + active custom intents + search / category pickers + create. */
export default function MyCustomIntents({ variant = 'full', className }: MyCustomIntentsProps) {
  const { user } = useCurrentUser();
  const { pushToast } = useNotifications();
  const viewerId = user?.id ?? null;

  const [balance, setBalance] = useState<number | null>(null);
  const [mine, setMine] = useState<MyIntent[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Intent[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchReq = useRef(0);

  const [tab, setTab] = useState<CategoryTab>('hot');
  const [hot, setHot] = useState<Intent[] | null>(null);
  const [location, setLocation] = useState<Intent[] | null>(null);
  const [nearby, setNearby] = useState<NearbyResult | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const [pending, setPending] = useState<PendingPurchase | null>(null);
  const [removing, setRemoving] = useState<MyIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const customMine = useMemo(() => (mine ?? []).filter((i) => i.kind !== 'preset'), [mine]);
  const ownedIds = useMemo(() => new Set((mine ?? []).map((i) => i.id)), [mine]);

  const loadBalance = useCallback(async () => {
    try {
      const p = await getMyPoints();
      setBalance(p.total);
    } catch (err) {
      console.warn('[intents] balance unavailable', err);
    }
  }, []);

  const loadMine = useCallback(async () => {
    try {
      setMine(await getMyIntents());
      setMineError(null);
    } catch (err) {
      setMineError(errorMessage(err, 'Could not load your intents'));
      setMine((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void loadBalance();
    void loadMine();
    const onChange = () => void loadBalance();
    window.addEventListener(POINTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(POINTS_CHANGED_EVENT, onChange);
  }, [loadBalance, loadMine]);

  // Inline search: prefix match, debounced, top 5.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    const id = ++searchReq.current;
    setSearching(true);
    const t = window.setTimeout(() => {
      searchIntents(q, SEARCH_LIMIT)
        .then((list) => id === searchReq.current && setResults(list))
        .catch((err) => {
          if (id !== searchReq.current) return;
          setResults([]);
          pushToast({ icon: 'search', title: 'Search failed', body: errorMessage(err, 'Could not search intents') });
        })
        .finally(() => id === searchReq.current && setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query, pushToast]);

  const loadTab = useCallback(
    async (which: CategoryTab) => {
      setTabError(null);
      try {
        if (which === 'hot') setHot((await getHotIntents()).slice(0, HOT_LIMIT));
        else if (which === 'location') setLocation(await getLocationIntents());
        else setNearby(await getNearbyIntents());
      } catch (err) {
        setTabError(errorMessage(err, 'Could not load intents'));
      }
    },
    []
  );

  useEffect(() => {
    if (variant !== 'full') return;
    if (tab === 'hot' && hot === null) void loadTab('hot');
    if (tab === 'location' && location === null) void loadTab('location');
    if (tab === 'nearby' && nearby === null) void loadTab('nearby');
  }, [variant, tab, hot, location, nearby, loadTab]);

  const isMine = useCallback((intent: Intent) => !!viewerId && intent.creator_id === viewerId, [viewerId]);

  const askPurchase = (intent: Intent, source: IntentSource) => {
    if (ownedIds.has(intent.id)) {
      pushToast({ icon: 'check', title: 'Already active', body: `“${intent.name}” is already one of your intents.` });
      return;
    }
    setPending({ intent, source });
  };

  const confirmPurchase = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const res = await purchaseIntent(pending.intent.id, pending.source);
      setBalance(res.balance);
      emitPointsChanged();
      pushToast({
        icon: 'sparkles',
        title: 'Intent added',
        body: res.price > 0 ? `“${pending.intent.name}” for ${res.price} tokens.` : `“${pending.intent.name}” is now active.`,
      });
      setPending(null);
      setQuery('');
      await loadMine();
    } catch (err) {
      pushToast({ icon: 'coin', title: 'Could not add intent', body: errorMessage(err, 'Could not add that intent') });
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing || busy) return;
    setBusy(true);
    try {
      await removeMyIntent(removing.id);
      pushToast({ icon: 'trash', title: 'Intent removed', body: `“${removing.name}” is no longer active.` });
      setRemoving(null);
      await loadMine();
    } catch (err) {
      pushToast({ icon: 'trash', title: 'Could not remove intent', body: errorMessage(err, 'Could not remove that intent') });
    } finally {
      setBusy(false);
    }
  };

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      pushToast({ icon: 'map-pin', title: 'Location unavailable', body: 'Your browser does not support geolocation.' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setNearby(null);
          await loadTab('nearby');
          pushToast({ icon: 'map-pin', title: 'Location saved', body: 'Used only for Near By. You can clear it any time.' });
        } catch (err) {
          pushToast({ icon: 'map-pin', title: 'Could not save location', body: errorMessage(err, 'Could not save your location') });
        } finally {
          setLocating(false);
        }
      },
      (geoErr) => {
        setLocating(false);
        const denied = geoErr.code === geoErr.PERMISSION_DENIED;
        pushToast({
          icon: 'map-pin',
          title: denied ? 'Location permission denied' : 'Could not get your location',
          body: denied ? 'Allow location access in your browser to use Near By.' : geoErr.message || 'Please try again.',
        });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  const clearLocation = async () => {
    try {
      await clearMyLocation();
      setNearby({ status: 'no_location' });
      pushToast({ icon: 'map-pin', title: 'Location cleared' });
    } catch (err) {
      pushToast({ icon: 'map-pin', title: 'Could not clear location', body: errorMessage(err, 'Could not clear your location') });
    }
  };

  const pendingPrice = pending ? intentPrice(pending.intent, pending.source, isMine(pending.intent)) : 0;
  const cannotAfford = pending !== null && balance !== null && pendingPrice > balance;

  return (
    <div className={`mci mci--${variant}${className ? ` ${className}` : ''}`}>
      <div className="mci-top">
        <div className="mci-balance" aria-live="polite">
          <TokenCoin size={18} title="Rendly Tokens" />
          <strong>{balance === null ? '—' : balance.toLocaleString('en-IN')}</strong>
          <span className="rd-small rd-muted">tokens</span>
        </div>
        <button type="button" className="rd-btn rd-btn--sm" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={14} />
          Create intent
        </button>
      </div>

      {mineError ? (
        <p className="acct-msg acct-msg--error" role="alert">
          {mineError}
        </p>
      ) : null}

      {mine === null ? (
        <div className="mci-chips" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="rd-skeleton mci-chip-skel" />
          ))}
        </div>
      ) : customMine.length === 0 ? (
        <p className="mci-empty">No custom intents yet. Search below or create your own.</p>
      ) : (
        <ul className="mci-chips" aria-label="Your custom intents">
          {customMine.map((intent) => {
            const days = intentDaysLeft(intent.expires_at);
            const isPrivate = intent.visibility === 'private';
            return (
              <li key={intent.id} className={`mci-chip${isPrivate ? ' mci-chip--private' : ''}`}>
                {isPrivate ? <Icon name="lock" size={12} className="mci-chip-lock" /> : null}
                <span className="mci-chip-name">{intent.name}</span>
                {days !== null ? <span className="mci-chip-days">{days} d left</span> : null}
                <button
                  type="button"
                  className="mci-chip-x"
                  aria-label={`Remove ${intent.name}`}
                  onClick={() => setRemoving(intent)}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mci-search">
        <label className="mci-search-box">
          <Icon name="search" size={16} className="mci-search-icon" />
          <input
            className="rd-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search intents to add…"
            aria-label="Search intents"
            autoComplete="off"
          />
          {searching ? <span className="rd-spinner mci-search-spin" aria-hidden /> : null}
        </label>
        <button type="button" className="rd-btn rd-btn--sm" onClick={() => setPickerOpen(true)} aria-label="More search results">
          More
        </button>
      </div>

      {query.trim() && results !== null ? (
        results.length === 0 ? (
          <p className="mci-empty">
            Nothing starts with “{query.trim()}”.{' '}
            <button type="button" className="mci-link" onClick={() => setCreateOpen(true)}>
              Create it
            </button>
          </p>
        ) : (
          <ul className="mci-results" aria-label="Search results">
            {results.map((intent) => {
              const mineFlag = isMine(intent);
              const owned = !!intent.owned || ownedIds.has(intent.id);
              return (
                <li key={intent.id} className="mci-row">
                  <span className="mci-row-name">{intent.name}</span>
                  <span className="mci-row-meta">{usageCount(intent).toLocaleString('en-IN')} active</span>
                  <span className={`mci-row-price${mineFlag ? ' mci-row-price--free' : ''}`}>
                    {mineFlag ? 'Free (yours)' : intentPriceLabel(intent, 'search', false)}
                  </span>
                  <button
                    type="button"
                    className="rd-btn rd-btn--sm rd-btn--primary"
                    onClick={() => askPurchase(intent, 'search')}
                    disabled={owned}
                    aria-label={owned ? `${intent.name} already added` : `Add ${intent.name}`}
                  >
                    {owned ? 'Added' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {variant === 'full' ? (
        <div className="mci-cats">
          <div className="spark-seg mci-seg" role="tablist" aria-label="Discover intents">
            {(
              [
                ['hot', 'flame', 'Hot'],
                ['location', 'map-pin', 'Location'],
                ['nearby', 'people', 'Near By'],
              ] as const
            ).map(([key, icon, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`spark-seg-btn${tab === key ? ' spark-seg-btn--on' : ''}`}
                onClick={() => setTab(key)}
              >
                <Icon name={icon} size={14} />
                {label}
              </button>
            ))}
          </div>
          <p className="mci-cat-hint rd-small rd-muted">
            Category picks cost {intentPrice({ kind: 'custom' }, tab, false)} tokens and stay active for {INTENT_PURCHASE_DAYS} days.
          </p>

          {tabError ? (
            <p className="acct-msg acct-msg--error" role="alert">
              {tabError}{' '}
              <button type="button" className="mci-link" onClick={() => void loadTab(tab)}>
                Retry
              </button>
            </p>
          ) : null}

          {tab === 'hot' ? (
            hot === null && !tabError ? (
              <div className="mci-grid" aria-hidden>
                {Array.from({ length: 6 }).map((_, i) => (
                  <span key={i} className="rd-skeleton mci-cell-skel" />
                ))}
              </div>
            ) : (hot ?? []).length === 0 ? (
              <p className="mci-empty">Nothing is trending yet.</p>
            ) : (
              <ul className="mci-grid" aria-label="Hot intents">
                {(hot ?? []).map((intent, i) => (
                  <li key={intent.id}>
                    <CategoryCell intent={intent} rank={i + 1} icon="flame" owned={ownedIds.has(intent.id)} mine={isMine(intent)} onPick={() => askPurchase(intent, 'hot')} />
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {tab === 'location' ? (
            location === null && !tabError ? (
              <div className="mci-list" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="rd-skeleton mci-row-skel" />
                ))}
              </div>
            ) : (location ?? []).length === 0 ? (
              <p className="mci-empty">No city intents yet.</p>
            ) : (
              <ul className="mci-list" aria-label="Location intents">
                {(location ?? []).map((intent) => (
                  <li key={intent.id}>
                    <CategoryCell intent={intent} icon="map-pin" subtitle={intent.city ?? intent.country ?? undefined} owned={ownedIds.has(intent.id)} mine={isMine(intent)} onPick={() => askPurchase(intent, 'location')} />
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {tab === 'nearby' ? (
            nearby === null && !tabError ? (
              <div className="mci-list" aria-hidden>
                <span className="rd-skeleton mci-row-skel" />
              </div>
            ) : nearby?.status === 'no_location' ? (
              <div className="mci-nearby-cta">
                <Icon name="map-pin" size={20} />
                <p className="rd-small rd-muted">Share your location to see what the nearest online person is into. Stored on your profile, never shown to others.</p>
                <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={useMyLocation} disabled={locating}>
                  {locating ? 'Locating…' : 'Use my location'}
                </button>
              </div>
            ) : nearby?.status === 'nobody' ? (
              <div className="mci-nearby-cta">
                <p className="rd-small rd-muted">Nobody online near you right now. Check back soon.</p>
                <button type="button" className="mci-link" onClick={clearLocation}>
                  Clear location
                </button>
              </div>
            ) : nearby?.status === 'ok' ? (
              <div className="mci-nearby">
                <div className="mci-nearby-user">
                  <Avatar url={nearby.user.avatar_url} name={nearby.user.username} size="sm" online />
                  <span className="mci-nearby-who">
                    @{nearby.user.username ?? 'someone'}
                    {nearby.user.distance_km !== null ? <span className="rd-muted"> · {nearby.user.distance_km.toFixed(1)} km away</span> : null}
                    {nearby.user.city ? <span className="rd-muted"> · {nearby.user.city}</span> : null}
                  </span>
                  <button type="button" className="mci-link" onClick={clearLocation}>
                    Clear location
                  </button>
                </div>
                {nearby.intents.length === 0 ? (
                  <p className="mci-empty">They have no intents set yet.</p>
                ) : (
                  <ul className="mci-list" aria-label="Nearby intents">
                    {nearby.intents.map((intent) => (
                      <li key={intent.id}>
                        <CategoryCell intent={intent} icon="sparkles" owned={ownedIds.has(intent.id)} mine={isMine(intent)} onPick={() => askPurchase(intent, 'nearby')} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null
          ) : null}
        </div>
      ) : null}

      <IntentPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        initialQuery={query}
        viewerId={viewerId}
        ownedIds={ownedIds}
        onPick={(intent) => {
          setPickerOpen(false);
          askPurchase(intent, 'search');
        }}
      />

      <CreateIntentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setQuery('');
          void loadMine();
        }}
      />

      <Modal
        open={pending !== null}
        onClose={busy ? undefined : () => setPending(null)}
        title={pending ? `Add “${pending.intent.name}”?` : undefined}
        footer={
          <>
            <button type="button" className="rd-btn" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="rd-btn rd-btn--primary" onClick={() => void confirmPurchase()} disabled={busy || cannotAfford}>
              {busy ? 'Adding…' : pendingPrice > 0 ? `Pay ${pendingPrice} tokens` : 'Add for free'}
            </button>
          </>
        }
      >
        {pending ? (
          <div className="mci-confirm">
            <div className="mci-confirm-price">
              <TokenAmount amount={-pendingPrice} size={16} signed={pendingPrice > 0} />
              <span className="rd-small rd-muted">
                {pendingPrice > 0
                  ? `Active for ${INTENT_PURCHASE_DAYS} days. Balance after: ${balance === null ? '—' : (balance - pendingPrice).toLocaleString('en-IN')}.`
                  : isMine(pending.intent)
                    ? 'Your own intent is always free.'
                    : 'Free.'}
              </span>
            </div>
            {cannotAfford ? (
              <p className="acct-msg acct-msg--error" role="alert">
                You need {pendingPrice - (balance ?? 0)} more tokens.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={removing !== null}
        onClose={busy ? undefined : () => setRemoving(null)}
        title={removing ? `Remove “${removing.name}”?` : undefined}
        footer={
          <>
            <button type="button" className="rd-btn" onClick={() => setRemoving(null)} disabled={busy}>
              Keep it
            </button>
            <button type="button" className="rd-btn rd-btn--danger" onClick={() => void confirmRemove()} disabled={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </>
        }
      >
        <p className="rd-small rd-muted">
          It stops matching you right away. Tokens already spent are not refunded; you can add it again later.
        </p>
      </Modal>
    </div>
  );
}

type CategoryCellProps = {
  intent: Intent;
  icon: string;
  rank?: number;
  subtitle?: string;
  owned: boolean;
  mine: boolean;
  onPick: () => void;
};

function CategoryCell({ intent, icon, rank, subtitle, owned, mine, onPick }: CategoryCellProps) {
  const count = usageCount(intent);
  const price = mine ? 'Free (yours)' : owned ? 'Added' : intentPriceLabel(intent, 'hot', false);
  return (
    <button
      type="button"
      className={`mci-cell${owned ? ' mci-cell--owned' : ''}`}
      onClick={onPick}
      disabled={owned}
      aria-label={`${intent.name}, ${count} active, ${price}`}
    >
      <span className="mci-cell-icon">
        {rank ? <span className="mci-cell-rank">#{rank}</span> : <Icon name={icon} size={14} />}
      </span>
      <span className="mci-cell-text">
        <span className="mci-cell-name">{intent.name}</span>
        <span className="mci-cell-sub">{subtitle ? `${subtitle} · ` : ''}{count.toLocaleString('en-IN')} active</span>
      </span>
      <span className={`mci-cell-price${mine ? ' mci-cell-price--free' : ''}`}>{price}</span>
    </button>
  );
}
