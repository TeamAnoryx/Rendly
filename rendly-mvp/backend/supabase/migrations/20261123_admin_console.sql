-- Admin console: first-party analytics, contact query replies, security events and the
-- permanent "Rendly Team" account every user has a Whisper with.

-- 1. Analytics events (page views, heartbeats for time on site, app opens, sign-ins).
-- No raw IP addresses are stored: only coarse country/city and a rounded location.
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL CHECK (type IN ('pageview', 'heartbeat', 'app_open', 'signin', 'signup')),
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  path TEXT NOT NULL DEFAULT '/',
  referrer TEXT,
  utm_source TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  country TEXT,
  city TEXT,
  lat NUMERIC(5, 1),
  lon NUMERIC(5, 1),
  device TEXT,
  browser TEXT,
  os TEXT
);

CREATE INDEX IF NOT EXISTS analytics_events_created_at ON analytics_events (created_at);
CREATE INDEX IF NOT EXISTS analytics_events_type_created_at ON analytics_events (type, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_user_created_at ON analytics_events (user_id, created_at) WHERE user_id IS NOT NULL;

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- 2. Contact queries: status, the admin's reply and where the query came from.
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'query';
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'contact_page';
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS reply TEXT;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_requests_status_check') THEN
    ALTER TABLE contact_requests
      ADD CONSTRAINT contact_requests_status_check CHECK (status IN ('open', 'answered', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_requests_category_check') THEN
    ALTER TABLE contact_requests
      ADD CONSTRAINT contact_requests_category_check CHECK (category IN ('query', 'feedback', 'bug', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contact_requests_status_created_at ON contact_requests (status, created_at DESC);

-- 3. Security and operations events shown on the admin Health page and used for alerts.
CREATE TABLE IF NOT EXISTS security_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail TEXT NOT NULL,
  ip_hash TEXT,
  path TEXT,
  alerted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS security_events_created_at ON security_events (created_at DESC);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- 4. The Rendly Team account. It has no password and no OAuth link, so nobody can sign in
-- as it; auth-service sends its messages (welcome, query replies, announcements).
INSERT INTO users (id, email, username, email_verified)
VALUES ('f0f0f0f0-0000-4000-8000-000000000001', 'rendly-team@system.invalid', 'rendlyteam', true)
ON CONFLICT (id) DO NOTHING;
