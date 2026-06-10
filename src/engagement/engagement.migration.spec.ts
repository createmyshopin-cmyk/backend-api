import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(__dirname, '../../supabase/migrations/20260610600000_engagement_sprint33b_sprint1.sql'),
  'utf8',
);

describe('Sprint 3.3B Sprint 1 engagement migration', () => {
  it('creates follows table with partial unique active index', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.follows/);
    expect(MIGRATION).toMatch(/uq_follows_active_pair/);
  });

  it('creates favorites table with max-50 enforcement in RPC', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.favorites/);
    expect(MIGRATION).toMatch(/favorite_limit_reached/);
  });

  it('creates append-only xp_events with idempotency unique index', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.xp_events/);
    expect(MIGRATION).toMatch(/uq_xp_events_subject_idempotency/);
  });

  it('creates user_levels and creator_levels projections', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.user_levels/);
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.creator_levels/);
  });

  it('defines rebuild functions', () => {
    expect(MIGRATION).toMatch(/rebuild_user_level/);
    expect(MIGRATION).toMatch(/rebuild_creator_level/);
  });

  it('denies client RLS on engagement tables', () => {
    expect(MIGRATION).toMatch(/follows_deny_clients/);
    expect(MIGRATION).toMatch(/xp_events_deny_clients/);
  });

  it('restricts RPC execute to service_role', () => {
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.follow_creator[\s\S]*TO service_role/,
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.follow_creator[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
  });
});
