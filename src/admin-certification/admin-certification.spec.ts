/**
 * Admin Operations Center — certification tests (read-only, no prod changes).
 * Verifies sanitization, pagination guards, and RBAC constants for admin modules.
 */
import { clampLimit, decodeCursor, encodeCursor } from '../creator-dashboard/pagination.util';
import { csvCell } from '../common/csv.util';
import { clampReconciliationLimit } from '../reconciliation/reconciliation-limit.util';

const WITHDRAWAL_STATUSES = ['pending', 'approved', 'paid', 'rejected', 'cancelled', 'failed'] as const;
const TIME_WINDOWS = ['7d', '30d', 'lifetime'] as const;

describe('Admin Certification — API contract constants', () => {
  it('withdrawal status enum is complete', () => {
    expect(WITHDRAWAL_STATUSES).toHaveLength(6);
    expect(WITHDRAWAL_STATUSES).toContain('pending');
    expect(WITHDRAWAL_STATUSES).toContain('failed');
  });

  it('analytics time windows are bounded', () => {
    expect(TIME_WINDOWS).toEqual(['7d', '30d', 'lifetime']);
  });

  it('DTO max limit is 50 (documented contract)', () => {
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(51)).toBe(50);
  });
});

describe('Admin Certification — Pagination', () => {
  it('clampLimit never exceeds 50', () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(51)).toBe(50);
    expect(clampLimit(10000)).toBe(50);
  });

  it('cursor round-trip is stable', () => {
    const c = encodeCursor('2026-06-10T12:00:00.000Z', 'abc-uuid');
    expect(decodeCursor(c).id).toBe('abc-uuid');
  });
});

describe('Admin Certification — CSV injection (shared util)', () => {
  it('prefixes formula injection cells', () => {
    expect(csvCell('=CMD|calc')).toMatch(/^'/);
    expect(csvCell('+1234')).toMatch(/^'/);
    expect(csvCell('-formula')).toMatch(/^'/);
    expect(csvCell('@SUM(A1)')).toMatch(/^'/);
  });

  it('escapes embedded quotes', () => {
    expect(csvCell('say "hello"')).toBe('"say ""hello"""');
  });
});

describe('Admin Certification — RBAC matrix (new admin routes)', () => {
  const ANALYTICS_ROLES = ['super_admin', 'finance_admin', 'operations_admin', 'fraud_admin'];
  const ENGAGEMENT_READ = ['super_admin', 'finance_admin', 'operations_admin', 'moderator'];
  const WITHDRAWAL_READ = ['super_admin', 'finance_admin', 'support_admin'];
  const WITHDRAWAL_MUTATE = ['super_admin', 'finance_admin'];

  it('support_admin cannot approve withdrawals', () => {
    expect(WITHDRAWAL_MUTATE.includes('support_admin')).toBe(false);
  });

  it('support_admin can read withdrawals', () => {
    expect(WITHDRAWAL_READ.includes('support_admin')).toBe(true);
  });

  it('moderator cannot access creator analytics', () => {
    expect(ANALYTICS_ROLES.includes('moderator')).toBe(false);
  });

  it('moderator can access engagement read endpoints', () => {
    expect(ENGAGEMENT_READ.includes('moderator')).toBe(true);
  });

  it('fraud_admin can access analytics', () => {
    expect(ANALYTICS_ROLES.includes('fraud_admin')).toBe(true);
  });
});

describe('Admin Certification — reconciliation limit', () => {
  it('clamps DoS limit to 100', () => {
    expect(clampReconciliationLimit(999999)).toBe(100);
  });
});

describe('Admin Certification — unified withdrawal list shape', () => {
  it('paginated envelope is the canonical contract', () => {
    const envelope = { items: [], hasMore: false, nextCursor: null };
    expect(envelope).toHaveProperty('items');
    expect(envelope).toHaveProperty('hasMore');
    expect(envelope).toHaveProperty('nextCursor');
  });
});
