-- Migration: add ended_reason to calls table
-- Tracks why a call ended for analytics purposes.
-- Values: user_hangup, creator_hangup, insufficient_coins, network_failure, missed_call

ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_reason TEXT;
