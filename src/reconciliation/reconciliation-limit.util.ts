export const RECONCILIATION_MAX_LIMIT = 100;

export function clampReconciliationLimit(limit?: number, fallback = 50): number {
  if (limit == null || Number.isNaN(limit)) return fallback;
  return Math.min(RECONCILIATION_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}
