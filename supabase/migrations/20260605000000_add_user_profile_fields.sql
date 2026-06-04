-- Profile fields for caller onboarding (PATCH /api/users/profile)
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

-- Backfill full_name from legacy name column where missing
UPDATE users
SET full_name = name
WHERE full_name IS NULL AND name IS NOT NULL AND trim(name) <> '';
