import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../supabase/migrations/20260610300000_creator_analytics_daily_sprint31b.sql',
  ),
  'utf8',
);

describe('Sprint 3.1B migration invariants', () => {
  it('creates creator_analytics_daily with required columns', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.creator_analytics_daily/);
    expect(MIGRATION).toMatch(/creator_profile_id\s+UUID NOT NULL/);
    expect(MIGRATION).toMatch(/date\s+DATE NOT NULL/);
    expect(MIGRATION).toMatch(/call_coins\s+NUMERIC/);
    expect(MIGRATION).toMatch(/gift_coins\s+NUMERIC/);
    expect(MIGRATION).toMatch(/total_coins\s+NUMERIC.*GENERATED ALWAYS AS \(call_coins \+ gift_coins\)/);
    expect(MIGRATION).toMatch(/call_count\s+INTEGER/);
    expect(MIGRATION).toMatch(/call_duration_seconds\s+INTEGER/);
    expect(MIGRATION).toMatch(/gifts_received_count\s+INTEGER/);
    expect(MIGRATION).toMatch(/created_at\s+TIMESTAMPTZ/);
    expect(MIGRATION).toMatch(/updated_at\s+TIMESTAMPTZ/);
  });

  it('enforces unique (creator_profile_id, date)', () => {
    expect(MIGRATION).toMatch(
      /uq_creator_analytics_daily_profile_date[\s\S]*ON public\.creator_analytics_daily \(creator_profile_id, date\)/,
    );
  });

  it('denies client RLS access', () => {
    expect(MIGRATION).toMatch(/creator_analytics_daily_deny_clients/);
    expect(MIGRATION).toMatch(/FOR ALL TO anon, authenticated USING \(false\)/);
  });

  it('updates _creator_ledger_append in same transaction as analytics', () => {
    const appendBlock = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\._creator_ledger_append[\s\S]*?END;\s*\$\$/i,
    )?.[0];
    expect(appendBlock).toBeTruthy();
    expect(appendBlock).toMatch(/apply_creator_ledger_to_wallet/);
    expect(appendBlock).toMatch(/_creator_analytics_daily_apply/);
    expect(appendBlock).toMatch(/IF v_id IS NULL THEN[\s\S]*RETURN v_id;/);
    expect(appendBlock).toMatch(
      /IF p_entry_type IN \('call_earning', 'gift_earning'\)/,
    );
  });

  it('does not increment analytics on idempotent ledger replay', () => {
    const appendBlock = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\._creator_ledger_append[\s\S]*?END;\s*\$\$/i,
    )?.[0];
    expect(appendBlock).toMatch(/DO NOTHING[\s\S]*IF v_id IS NULL THEN[\s\S]*RETURN v_id;/);
    const afterReturn = appendBlock!.split('IF v_id IS NULL THEN')[1];
    expect(afterReturn!.indexOf('_creator_analytics_daily_apply')).toBeGreaterThan(
      afterReturn!.indexOf('RETURN v_id'),
    );
  });

  it('routes call and gift earnings through _creator_ledger_append', () => {
    expect(MIGRATION).toMatch(/end_call_billing[\s\S]*_creator_ledger_append/);
    expect(MIGRATION).toMatch(/send_gift[\s\S]*_creator_ledger_append/);
    expect(MIGRATION).not.toMatch(
      /send_gift[\s\S]*PERFORM public\.increment_creator_wallet/,
    );
  });

  it('defines idempotent rebuild_creator_analytics_daily', () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.rebuild_creator_analytics_daily/);
    expect(MIGRATION).toMatch(/DELETE FROM public\.creator_analytics_daily/);
    expect(MIGRATION).toMatch(/FULL OUTER JOIN gift_agg/);
    expect(MIGRATION).toMatch(/SECURITY DEFINER/);
  });

  it('revokes public execute on internal analytics apply', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\._creator_analytics_daily_apply/,
    );
  });

  it('grants rebuild only to service_role', () => {
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.rebuild_creator_analytics_daily[\s\S]*TO service_role/,
    );
  });
});

describe('Analytics event coverage (design)', () => {
  const EARNING_TYPES = ['call_earning', 'gift_earning'];
  const NON_EARNING_TYPES = [
    'withdrawal_reserve',
    'withdrawal_release',
    'withdrawal_payout',
    'adjustment_credit',
    'adjustment_debit',
  ];

  it('only call_earning and gift_earning trigger L4 apply', () => {
    for (const type of EARNING_TYPES) {
      expect(MIGRATION).toContain(`'${type}'`);
    }
    const applyFn = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\._creator_analytics_daily_apply[\s\S]*?END;\s*\$\$/i,
    )?.[0];
    expect(applyFn).toMatch(/IF p_entry_type NOT IN \('call_earning', 'gift_earning'\)/);
    for (const type of NON_EARNING_TYPES) {
      expect(applyFn).not.toMatch(new RegExp(`WHEN '${type}'`));
    }
  });
});

describe('Concurrency and idempotency (design)', () => {
  it('uses ON CONFLICT upsert for daily buckets', () => {
    expect(MIGRATION).toMatch(
      /ON CONFLICT \(creator_profile_id, date\) DO UPDATE/,
    );
  });

  it('uses ledger source uniqueness for idempotent earns', () => {
    expect(MIGRATION).toMatch(
      /ON CONFLICT \(source_type, source_id, entry_type\)/,
    );
  });
});

describe('Large history query support', () => {
  it('indexes profile + date desc for bounded window scans', () => {
    expect(MIGRATION).toMatch(/idx_creator_analytics_daily_profile_date_desc/);
    expect(MIGRATION).toMatch(/\(creator_profile_id, date DESC\)/);
  });

  it('get_creator_analytics_window aggregates bounded date range', () => {
    expect(MIGRATION).toMatch(/get_creator_analytics_window/);
    expect(MIGRATION).toMatch(/date >= p_from_date/);
    expect(MIGRATION).toMatch(/date <= COALESCE\(p_to_date/);
  });
});
