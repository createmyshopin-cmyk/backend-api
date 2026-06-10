import {
  levelFromTotalXp,
  userLevelTitle,
  xpThresholdForLevel,
} from './xp.util';

describe('xp.util', () => {
  it('level 1 starts at 0 xp', () => {
    expect(xpThresholdForLevel(1)).toBe(0);
    expect(levelFromTotalXp(0)).toBe(1);
  });

  it('increases level as xp grows', () => {
    expect(levelFromTotalXp(100)).toBeGreaterThanOrEqual(2);
    expect(levelFromTotalXp(10_000)).toBeGreaterThanOrEqual(10);
  });

  it('caps at max user level', () => {
    expect(levelFromTotalXp(1_000_000)).toBeLessThanOrEqual(50);
  });

  it('maps level titles', () => {
    expect(userLevelTitle(1)).toBe('Newcomer');
    expect(userLevelTitle(40)).toBe('Legend');
  });
});
