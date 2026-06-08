/** Authoritative call-end summary returned to Flutter (source of truth). */
export interface CallEndSummary {
  callDuration: number;
  callCoinsSpent: number;
  giftCoinsSpent: number;
  totalCoinsSpent: number;
  remainingBalance?: number;
  creatorCallEarnings: number;
  creatorGiftEarnings: number;
  creatorTotalEarnings: number;
}

export function buildCallEndSummary(params: {
  callDuration: number;
  callCoinsSpent: number;
  giftCoinsSpent: number;
  creatorCallEarnings: number;
  creatorGiftEarnings: number;
  remainingBalance?: number;
}): CallEndSummary {
  const callDuration = Math.max(0, Math.floor(params.callDuration));
  const callCoinsSpent = Math.max(0, Math.floor(params.callCoinsSpent));
  const giftCoinsSpent = Math.max(0, Math.floor(params.giftCoinsSpent));
  const creatorCallEarnings = Math.max(0, Math.floor(params.creatorCallEarnings));
  const creatorGiftEarnings = Math.max(0, Math.floor(params.creatorGiftEarnings));
  const totalCoinsSpent = callCoinsSpent + giftCoinsSpent;
  const creatorTotalEarnings = creatorCallEarnings + creatorGiftEarnings;

  return {
    callDuration,
    callCoinsSpent,
    giftCoinsSpent,
    totalCoinsSpent,
    remainingBalance: params.remainingBalance,
    creatorCallEarnings,
    creatorGiftEarnings,
    creatorTotalEarnings,
  };
}

/** ceil(seconds / 60) × ratePerMinute — minimum one billed minute. */
export function computeCallCoins(durationSeconds: number, ratePerMinute: number): number {
  const minutes = Math.ceil(Math.max(0, durationSeconds) / 60);
  return Math.max(1, minutes) * ratePerMinute;
}
