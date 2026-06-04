-- ============================================================
-- Migration: creator_profiles table
-- Linked to public.users via user_id FK.
-- The users table uses custom UUID PKs (not Supabase auth.users).
-- ============================================================

-- Ensure users table has required columns for creator support
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_creator BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;

-- Creator profile details (1-to-1 with users)
CREATE TABLE IF NOT EXISTS creator_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bio             TEXT,
  languages       TEXT NOT NULL DEFAULT 'Malayalam',
  experience      TEXT,
  price_per_minute INTEGER NOT NULL DEFAULT 10,
  rating          NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
  total_calls     INTEGER NOT NULL DEFAULT 0,
  total_earnings  NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  online_status   BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

-- Index for fast creator lookup
CREATE INDEX IF NOT EXISTS idx_creator_profiles_user_id ON creator_profiles(user_id);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_creator_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creator_profiles_updated_at ON creator_profiles;
CREATE TRIGGER trg_creator_profiles_updated_at
  BEFORE UPDATE ON creator_profiles
  FOR EACH ROW EXECUTE FUNCTION update_creator_profiles_updated_at();
