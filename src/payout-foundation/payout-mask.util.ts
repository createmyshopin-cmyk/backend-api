/**
 * Display masking for payout/KYC fields — must stay aligned with SQL
 * functions payout_mask_* in migration 20260610400000_payout_account_foundation_sprint32b.sql
 */

export function maskPayoutUpi(upi: string | null | undefined): string | null {
  if (!upi?.trim()) return null;
  const trimmed = upi.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

export function maskPayoutBankAccount(
  num: string | null | undefined,
): string | null {
  if (!num?.trim()) return null;
  const digits = num.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `****${digits.slice(-4)}`;
}

export function maskPayoutPan(pan: string | null | undefined): string | null {
  if (!pan?.trim()) return null;
  const upper = pan.replace(/\s/g, '').toUpperCase();
  if (upper.length < 4) return null;
  return `${upper.slice(0, 2)}****${upper.slice(-4)}`;
}

export function maskPayoutAadhaar(
  aadhaar: string | null | undefined,
): string | null {
  if (!aadhaar?.trim()) return null;
  const digits = aadhaar.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

export function maskPayoutGstin(
  gstin: string | null | undefined,
): string | null {
  if (!gstin?.trim()) return null;
  const upper = gstin.replace(/\s/g, '').toUpperCase();
  if (upper.length < 6) return null;
  return `${upper.slice(0, 4)}****${upper.slice(-4)}`;
}

/** Minimum key length enforced by payout_encryption_key() in Postgres. */
export const PAYOUT_FIELD_ENCRYPTION_KEY_MIN_LENGTH = 32;

export function isPayoutEncryptionKeyConfigured(
  key: string | null | undefined,
): boolean {
  return !!key && key.trim().length >= PAYOUT_FIELD_ENCRYPTION_KEY_MIN_LENGTH;
}
