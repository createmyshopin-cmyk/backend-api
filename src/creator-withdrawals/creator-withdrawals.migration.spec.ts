import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../supabase/migrations/20260610500000_withdrawal_api_sprint32b_sprint2.sql',
  ),
  'utf8',
);

describe('Sprint 3.2B Sprint 2 withdrawal API migration', () => {
  it('adds payout_account_id FK on withdrawals', () => {
    expect(MIGRATION).toMatch(/payout_account_id UUID REFERENCES public\.payout_accounts/);
  });

  it('adds history performance index', () => {
    expect(MIGRATION).toMatch(/idx_withdrawals_profile_requested/);
  });

  it('seeds withdrawal policy columns on app_settings', () => {
    expect(MIGRATION).toMatch(/max_daily_withdrawal_inr/);
    expect(MIGRATION).toMatch(/max_monthly_withdrawal_inr/);
    expect(MIGRATION).toMatch(/kyc_threshold_inr/);
  });

  it('extends request_creator_withdrawal with payout_account_id', () => {
    expect(MIGRATION).toMatch(/p_payout_account_id\s+UUID DEFAULT NULL/);
    expect(MIGRATION).toMatch(/RAISE EXCEPTION 'payout_account_missing'/);
    expect(MIGRATION).toMatch(/RAISE EXCEPTION 'withdrawal_inflight'/);
    expect(MIGRATION).toMatch(/RAISE EXCEPTION 'daily_limit_exceeded'/);
    expect(MIGRATION).toMatch(/RAISE EXCEPTION 'kyc_required'/);
  });

  it('adds status snapshot RPC', () => {
    expect(MIGRATION).toMatch(/get_creator_withdrawal_status_snapshot/);
  });

  it('restricts RPC execute to service_role', () => {
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.request_creator_withdrawal[\s\S]*TO service_role/,
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.request_creator_withdrawal[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
  });

  it('updates upsert_creator_payout_account with update path', () => {
    expect(MIGRATION).toMatch(/IF v_existing IS NOT NULL THEN/);
  });
});
