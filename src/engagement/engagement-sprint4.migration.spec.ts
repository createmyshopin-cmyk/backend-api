import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(__dirname, '../../supabase/migrations/20260610900000_engagement_sprint33b_sprint4.sql'),
  'utf8',
);

describe('Sprint 3.3B Sprint 4 VIP migration', () => {
  it('creates vip_plans catalog', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.vip_plans/);
    expect(MIGRATION).toMatch(/uq_vip_plans_tier_active/);
  });

  it('creates user_memberships with one-active constraint', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.user_memberships/);
    expect(MIGRATION).toMatch(/uq_user_memberships_one_active/);
  });

  it('creates membership_events append-only', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.membership_events/);
    expect(MIGRATION).toMatch(/uq_membership_events_idempotency/);
  });

  it('creates membership_rewards and seeds tiers', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.membership_rewards/);
    expect(MIGRATION).toMatch(/silver.*welcome/i);
    expect(MIGRATION).toMatch(/platinum.*welcome/i);
  });

  it('seeds silver gold platinum plans', () => {
    expect(MIGRATION).toMatch(/'silver', 'Silver VIP'/);
    expect(MIGRATION).toMatch(/'gold', 'Gold VIP'/);
    expect(MIGRATION).toMatch(/'platinum', 'Platinum VIP'/);
  });

  it('defines VIP RPCs', () => {
    expect(MIGRATION).toMatch(/initiate_vip_subscription/);
    expect(MIGRATION).toMatch(/activate_vip_membership/);
    expect(MIGRATION).toMatch(/get_vip_plans/);
    expect(MIGRATION).toMatch(/get_vip_status/);
    expect(MIGRATION).toMatch(/get_vip_membership_history/);
    expect(MIGRATION).toMatch(/rebuild_user_vip_summary/);
  });

  it('denies client RLS', () => {
    expect(MIGRATION).toMatch(/vip_plans_deny_clients/);
    expect(MIGRATION).toMatch(/user_memberships_deny_clients/);
  });
});
