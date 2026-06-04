-- Preferred app language for callers (PATCH /api/users/profile)
ALTER TABLE users ADD COLUMN IF NOT EXISTS language varchar;
