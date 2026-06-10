/** User level curve — mirrors Postgres xp_threshold_for_level (max 50). */
const MAX_USER_LEVEL = 50;
const MAX_CREATOR_LEVEL = 30;

export function xpThresholdForLevel(level: number, maxLevel = MAX_USER_LEVEL): number {
  if (level <= 1) return 0;
  if (level > maxLevel) return xpThresholdForLevel(maxLevel, maxLevel);
  return Math.floor(100 * Math.pow(level - 1, 1.35));
}

export function levelFromTotalXp(totalXp: number, maxLevel = MAX_USER_LEVEL): number {
  let level = 1;
  while (
    level < maxLevel &&
    xpThresholdForLevel(level + 1, maxLevel) <= totalXp
  ) {
    level += 1;
  }
  return level;
}

export function userLevelTitle(level: number): string {
  if (level >= 40) return 'Legend';
  if (level >= 25) return 'Veteran';
  if (level >= 15) return 'Regular';
  if (level >= 8) return 'Explorer';
  if (level >= 4) return 'Active';
  return 'Newcomer';
}

export function creatorLevelTitle(level: number): string {
  if (level >= 25) return 'Top Creator';
  if (level >= 15) return 'Established';
  if (level >= 8) return 'Rising Star';
  if (level >= 4) return 'Growing';
  return 'New Creator';
}

export { MAX_USER_LEVEL, MAX_CREATOR_LEVEL };
