-- Huddles (group video calls) and participants.
-- Requires users.id (UUID). Run after users table exists.

CREATE TABLE IF NOT EXISTS huddles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  max_participants INT NOT NULL DEFAULT 10 CHECK (max_participants IN (10, 15, 20, 50)),
  type TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public', 'private', 'instant')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  duration_minutes INT CHECK (duration_minutes IS NULL OR (duration_minutes >= 1 AND duration_minutes <= 30)),
  invite_code TEXT UNIQUE,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huddles_created_by ON huddles(created_by);
CREATE INDEX IF NOT EXISTS idx_huddles_is_active ON huddles(is_active);
CREATE INDEX IF NOT EXISTS idx_huddles_scheduled_at ON huddles(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_huddles_created_at ON huddles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huddles_invite_code ON huddles(invite_code) WHERE invite_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS huddle_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  duration_seconds INT,
  UNIQUE(huddle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_huddle_participants_huddle_id ON huddle_participants(huddle_id);
CREATE INDEX IF NOT EXISTS idx_huddle_participants_user_id ON huddle_participants(user_id);
