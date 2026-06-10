/**
 * Semantic version comparison (major.minor.patch).
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

export function isVersionLessThan(installed: string, minimum: string): boolean {
  return compareSemver(installed, minimum) < 0;
}

export function isVersionAtLeast(installed: string, target: string): boolean {
  return compareSemver(installed, target) >= 0;
}

function parseSemver(v: string): [number, number, number] {
  const cleaned = (v ?? '').trim().replace(/^v/i, '');
  const parts = cleaned.split('.').map((p) => parseInt(p.replace(/[^0-9].*$/, ''), 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
