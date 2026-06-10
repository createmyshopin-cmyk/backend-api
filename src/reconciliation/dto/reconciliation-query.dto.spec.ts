import { clampReconciliationLimit, RECONCILIATION_MAX_LIMIT } from '../reconciliation-limit.util';

describe('clampReconciliationLimit', () => {
  it('defaults to fallback', () => {
    expect(clampReconciliationLimit(undefined, 50)).toBe(50);
  });

  it('clamps to max 100', () => {
    expect(clampReconciliationLimit(999999)).toBe(RECONCILIATION_MAX_LIMIT);
  });

  it('floors at 1', () => {
    expect(clampReconciliationLimit(0)).toBe(1);
  });
});
