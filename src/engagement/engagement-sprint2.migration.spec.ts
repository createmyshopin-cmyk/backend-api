import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(__dirname, '../../supabase/migrations/20260610700000_engagement_sprint33b_sprint2.sql'),
  'utf8',
);

describe('Sprint 3.3B Sprint 2 missions/streaks migration', () => {
  it('creates daily_missions catalog', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.daily_missions/);
    expect(MIGRATION).toMatch(/uq_daily_missions_key_active/);
  });

  it('creates mission_progress with per-user-day uniqueness', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.mission_progress/);
    expect(MIGRATION).toMatch(/uq_mission_progress_user_mission_date/);
  });

  it('creates user_streaks projection', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.user_streaks/);
  });

  it('seeds streak milestones 1/3/7/30/90/365', () => {
    expect(MIGRATION).toMatch(/INSERT INTO public\.streak_milestones/);
    expect(MIGRATION).toMatch(/\(1, 5, 0, 'Day 1'\)/);
    expect(MIGRATION).toMatch(/\(365, 500, 100, 'Year Legend'\)/);
  });

  it('creates append-only engagement_reward_events', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.engagement_reward_events/);
    expect(MIGRATION).toMatch(/uq_engagement_reward_idempotency/);
  });

  it('defines mission and streak RPCs', () => {
    expect(MIGRATION).toMatch(/increment_mission_progress/);
    expect(MIGRATION).toMatch(/claim_mission_reward/);
    expect(MIGRATION).toMatch(/record_streak_qualifying_day/);
    expect(MIGRATION).toMatch(/claim_streak_milestone/);
    expect(MIGRATION).toMatch(/get_daily_missions_board/);
  });

  it('denies client RLS on sprint2 tables', () => {
    expect(MIGRATION).toMatch(/daily_missions_deny_clients/);
    expect(MIGRATION).toMatch(/mission_progress_deny_clients/);
    expect(MIGRATION).toMatch(/user_streaks_deny_clients/);
  });

  it('restricts sprint2 RPC execute to service_role', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_mission_reward[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.claim_mission_reward[\s\S]*TO service_role/,
    );
  });
});
