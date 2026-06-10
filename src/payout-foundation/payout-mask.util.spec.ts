import {
  isPayoutEncryptionKeyConfigured,
  maskPayoutAadhaar,
  maskPayoutBankAccount,
  maskPayoutGstin,
  maskPayoutPan,
  maskPayoutUpi,
  PAYOUT_FIELD_ENCRYPTION_KEY_MIN_LENGTH,
} from './payout-mask.util';

describe('payout mask utilities (aligned with SQL payout_mask_*)', () => {
  describe('maskPayoutUpi', () => {
    it('masks UPI local part', () => {
      expect(maskPayoutUpi('priya@okaxis')).toBe('pri***@okaxis');
      expect(maskPayoutUpi('priya@upi')).toBe('pri***@upi');
    });

    it('returns *** for invalid UPI', () => {
      expect(maskPayoutUpi('@bad')).toBe('***');
      expect(maskPayoutUpi(null)).toBeNull();
    });
  });

  describe('maskPayoutBankAccount', () => {
    it('masks to last four digits', () => {
      expect(maskPayoutBankAccount('1234567890')).toBe('****7890');
    });

    it('strips non-digits', () => {
      expect(maskPayoutBankAccount('1234-5678-90')).toBe('****7890');
    });

    it('returns **** for short numbers', () => {
      expect(maskPayoutBankAccount('123')).toBe('****');
    });
  });

  describe('maskPayoutPan', () => {
    it('masks PAN middle', () => {
      expect(maskPayoutPan('ABCDE1234F')).toBe('AB****234F');
    });
  });

  describe('maskPayoutAadhaar', () => {
    it('masks aadhaar to last four', () => {
      expect(maskPayoutAadhaar('123456789012')).toBe('XXXX-XXXX-9012');
    });
  });

  describe('maskPayoutGstin', () => {
    it('masks GSTIN middle', () => {
      expect(maskPayoutGstin('22AAAAA0000A1Z5')).toBe('22AA****A1Z5');
    });
  });
});

describe('payout encryption key configuration', () => {
  it('requires minimum 32 characters', () => {
    expect(PAYOUT_FIELD_ENCRYPTION_KEY_MIN_LENGTH).toBe(32);
    expect(isPayoutEncryptionKeyConfigured('a'.repeat(31))).toBe(false);
    expect(isPayoutEncryptionKeyConfigured('a'.repeat(32))).toBe(true);
    expect(isPayoutEncryptionKeyConfigured(null)).toBe(false);
  });
});
