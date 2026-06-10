import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../supabase/migrations/20260610400000_payout_account_foundation_sprint32b.sql',
  ),
  'utf8',
);

describe('Sprint 3.2B payout_accounts migration', () => {
  it('creates payout_accounts with required columns', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.payout_accounts/);
    expect(MIGRATION).toMatch(/creator_profile_id\s+UUID NOT NULL/);
    expect(MIGRATION).toMatch(/type\s+TEXT NOT NULL CHECK \(type IN \('upi', 'bank'\)\)/);
    expect(MIGRATION).toMatch(/account_name\s+TEXT NOT NULL/);
    expect(MIGRATION).toMatch(/upi_id_encrypted\s+BYTEA/);
    expect(MIGRATION).toMatch(/upi_id_masked\s+TEXT/);
    expect(MIGRATION).toMatch(/bank_name\s+TEXT/);
    expect(MIGRATION).toMatch(/account_number_encrypted\s+BYTEA/);
    expect(MIGRATION).toMatch(/account_number_masked\s+TEXT/);
    expect(MIGRATION).toMatch(/ifsc_code\s+TEXT/);
    expect(MIGRATION).toMatch(/is_default\s+BOOLEAN NOT NULL DEFAULT false/);
    expect(MIGRATION).toMatch(/status\s+TEXT NOT NULL DEFAULT 'pending_verification'/);
    expect(MIGRATION).toMatch(/created_at\s+TIMESTAMPTZ/);
    expect(MIGRATION).toMatch(/updated_at\s+TIMESTAMPTZ/);
  });

  it('does not store plaintext upi_id or account_number columns', () => {
    expect(MIGRATION).not.toMatch(/\n\s+upi_id\s+TEXT/);
    expect(MIGRATION).not.toMatch(/\n\s+account_number\s+TEXT/);
  });

  it('enforces one default account per creator', () => {
    expect(MIGRATION).toMatch(/uq_payout_account_one_default/);
    expect(MIGRATION).toMatch(
      /WHERE is_default = true AND disabled_at IS NULL/,
    );
    expect(MIGRATION).toMatch(/enforce_single_default_payout_account/);
  });

  it('enforces type-specific field shapes', () => {
    expect(MIGRATION).toMatch(/payout_accounts_upi_shape/);
    expect(MIGRATION).toMatch(/payout_accounts_bank_shape/);
  });

  it('denies client RLS on payout_accounts', () => {
    expect(MIGRATION).toMatch(/payout_accounts_deny_clients/);
    expect(MIGRATION).toMatch(
      /ON public\.payout_accounts[\s\S]*FOR ALL TO anon, authenticated USING \(false\)/,
    );
  });

  it('includes future provider token columns', () => {
    expect(MIGRATION).toMatch(/razorpayx_fund_account_id/);
    expect(MIGRATION).toMatch(/cashfree_bene_id/);
    expect(MIGRATION).toMatch(/stripe_external_account_id/);
    expect(MIGRATION).toMatch(/wise_recipient_id/);
  });
});

describe('Sprint 3.2B kyc_profiles migration', () => {
  it('creates kyc_profiles with PAN/Aadhaar/GST support', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.kyc_profiles/);
    expect(MIGRATION).toMatch(
      /creator_profile_id\s+UUID NOT NULL UNIQUE REFERENCES public\.creator_profiles/,
    );
    expect(MIGRATION).toMatch(/pan_encrypted\s+BYTEA/);
    expect(MIGRATION).toMatch(/pan_masked\s+TEXT/);
    expect(MIGRATION).toMatch(/aadhaar_encrypted\s+BYTEA/);
    expect(MIGRATION).toMatch(/aadhaar_masked\s+TEXT/);
    expect(MIGRATION).toMatch(/gstin_encrypted\s+BYTEA/);
    expect(MIGRATION).toMatch(/gstin_masked\s+TEXT/);
    expect(MIGRATION).toMatch(
      /status\s+TEXT NOT NULL DEFAULT 'not_started'/,
    );
  });

  it('denies client RLS on kyc_profiles', () => {
    expect(MIGRATION).toMatch(/kyc_profiles_deny_clients/);
  });
});

describe('Sprint 3.2B payout_provider_events migration', () => {
  it('creates webhook evidence table for all providers', () => {
    expect(MIGRATION).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.payout_provider_events/,
    );
    expect(MIGRATION).toMatch(
      /provider\s+TEXT NOT NULL CHECK \(provider IN \([\s\S]*'razorpayx'[\s\S]*'cashfree'[\s\S]*'stripe'[\s\S]*'wise'/,
    );
    expect(MIGRATION).toMatch(/provider_event_id\s+TEXT NOT NULL/);
    expect(MIGRATION).toMatch(/payload_hash\s+TEXT NOT NULL/);
    expect(MIGRATION).toMatch(/payload_json\s+JSONB NOT NULL/);
    expect(MIGRATION).toMatch(/uq_payout_provider_events_provider_event/);
  });

  it('makes provider events append-only', () => {
    expect(MIGRATION).toMatch(/deny_payout_provider_event_mutation/);
    expect(MIGRATION).toMatch(/payout_provider_events is append-only/);
  });

  it('denies client RLS on payout_provider_events', () => {
    expect(MIGRATION).toMatch(/payout_provider_events_deny_clients/);
  });
});

describe('Sprint 3.2B encryption infrastructure', () => {
  it('enables pgcrypto and defines encrypt/decrypt helpers', () => {
    expect(MIGRATION).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/);
    expect(MIGRATION).toMatch(/payout_encryption_key\(\)/);
    expect(MIGRATION).toMatch(/pgp_sym_encrypt/);
    expect(MIGRATION).toMatch(/pgp_sym_decrypt/);
    expect(MIGRATION).toMatch(/payout_encryption_key_not_configured/);
  });

  it('revokes public decrypt access', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.payout_decrypt_sensitive/,
    );
  });

  it('encrypts sensitive fields in upsert RPC', () => {
    const upsert = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\.upsert_creator_payout_account[\s\S]*?END;\s*\$\$/i,
    )?.[0];
    expect(upsert).toBeTruthy();
    expect(upsert).toMatch(/payout_encrypt_sensitive\(trim\(p_upi_id\)\)/);
    expect(upsert).toMatch(/payout_mask_upi\(trim\(p_upi_id\)\)/);
    expect(upsert).toMatch(
      /payout_encrypt_sensitive\(trim\(p_account_number\)\)/,
    );
    expect(upsert).toMatch(
      /payout_mask_bank_account\(trim\(p_account_number\)\)/,
    );
  });
});

describe('Sprint 3.2B creator ownership (RPC design)', () => {
  it('upsert validates creator_profile exists', () => {
    expect(MIGRATION).toMatch(/creator_profile_not_found/);
    expect(MIGRATION).toMatch(
      /FROM public\.creator_profiles WHERE id = p_creator_profile_id/,
    );
  });

  it('get default account scopes by creator_profile_id', () => {
    const getDefault = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\.get_creator_default_payout_account[\s\S]*?END;\s*\$\$/i,
    )?.[0];
    expect(getDefault).toMatch(/WHERE creator_profile_id = p_creator_profile_id/);
    expect(getDefault).not.toMatch(/upi_id_encrypted/);
    expect(getDefault).toMatch(/upiIdMasked/);
  });

  it('grants service RPCs to service_role only', () => {
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.upsert_creator_payout_account[\s\S]*TO service_role/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_creator_default_payout_account\(UUID\) TO service_role/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_payout_provider_event[\s\S]*TO service_role/,
    );
  });
});

describe('Sprint 3.2B provider event idempotency', () => {
  it('record_payout_provider_event dedupes by provider + event id', () => {
    const record = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\.record_payout_provider_event[\s\S]*?END;\s*\$\$/i,
    )?.[0];
    expect(record).toMatch(/idempotentReplay/);
    expect(record).toMatch(/provider = p_provider/);
    expect(record).toMatch(/provider_event_id = p_provider_event_id/);
  });
});
