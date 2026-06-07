-- Enable Supabase Realtime for creator presence (is_online, last_seen_at).
-- Flutter clients subscribe with the anon key; RLS allows read-only presence.

ALTER TABLE creator_profiles REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'creator_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE creator_profiles;
  END IF;
END $$;

ALTER TABLE creator_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creator_profiles_presence_read ON creator_profiles;
CREATE POLICY creator_profiles_presence_read ON creator_profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);
