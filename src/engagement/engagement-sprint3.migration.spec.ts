import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(__dirname, '../../supabase/migrations/20260610800000_engagement_sprint33b_sprint3.sql'),
  'utf8',
);

describe('Sprint 3.3B Sprint 3 premium/combo migration', () => {
  it('creates premium_gifts catalog', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.premium_gifts/);
    expect(MIGRATION).toMatch(/uq_premium_gifts_gift_active/);
  });

  it('creates gift_combos L2 evidence', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.gift_combos/);
    expect(MIGRATION).toMatch(/gift_transaction_id UUID NOT NULL UNIQUE/);
  });

  it('creates gift_combo_rewards milestones 2-100', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.gift_combo_rewards/);
    expect(MIGRATION).toMatch(/\(2, 5, 0, '2x Combo'/);
    expect(MIGRATION).toMatch(/\(100, 300, 100, '100x Combo'/);
  });

  it('creates combo_progress projection', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.combo_progress/);
    expect(MIGRATION).toMatch(/rebuild_combo_progress/);
  });

  it('defines server combo RPCs', () => {
    expect(MIGRATION).toMatch(/process_gift_combo_after_send/);
    expect(MIGRATION).toMatch(/get_premium_gifts_catalog/);
    expect(MIGRATION).toMatch(/get_combo_status/);
    expect(MIGRATION).toMatch(/get_combo_history/);
  });

  it('patches send_gift with combo processing', () => {
    expect(MIGRATION).toMatch(/process_gift_combo_after_send\(/);
    expect(MIGRATION).toMatch(/comboCount/);
  });

  it('denies client RLS on sprint3 tables', () => {
    expect(MIGRATION).toMatch(/premium_gifts_deny_clients/);
    expect(MIGRATION).toMatch(/gift_combos_deny_clients/);
    expect(MIGRATION).toMatch(/combo_progress_deny_clients/);
  });
});
