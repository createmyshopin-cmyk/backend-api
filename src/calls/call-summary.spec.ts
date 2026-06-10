import { buildCallEndSummary, computeCallCoins } from './call-summary';

describe('computeCallCoins', () => {
  it('bills 10 coins/minute for a 10-minute call (scenario 1)', () => {
    expect(computeCallCoins(600, 10)).toBe(100);
  });

  it('bills at least one minute', () => {
    expect(computeCallCoins(30, 10)).toBe(10);
  });

  it('ceil partial minutes', () => {
    expect(computeCallCoins(61, 10)).toBe(20);
  });
});

describe('buildCallEndSummary', () => {
  it('combines call and gift coins (scenario 2)', () => {
    const summary = buildCallEndSummary({
      callDuration: 600,
      callCoinsSpent: 100,
      giftCoinsSpent: 500,
      creatorCallEarnings: 70,
      creatorGiftEarnings: 300,
      remainingBalance: 2400,
    });

    expect(summary.callDuration).toBe(600);
    expect(summary.callCoinsSpent).toBe(100);
    expect(summary.giftCoinsSpent).toBe(500);
    expect(summary.totalCoinsSpent).toBe(600);
    expect(summary.remainingBalance).toBe(2400);
  });

  it('sums creator earnings (scenario 3)', () => {
    const summary = buildCallEndSummary({
      callDuration: 600,
      callCoinsSpent: 100,
      giftCoinsSpent: 500,
      creatorCallEarnings: 70,
      creatorGiftEarnings: 300,
    });

    expect(summary.creatorCallEarnings).toBe(70);
    expect(summary.creatorGiftEarnings).toBe(300);
    expect(summary.creatorTotalEarnings).toBe(370);
  });
});
