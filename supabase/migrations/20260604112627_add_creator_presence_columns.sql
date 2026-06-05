-- Creator presence: heartbeat updates last_seen_at; online if seen within 60s
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_creator_profiles_last_seen_at
  ON creator_profiles (last_seen_at DESC);
