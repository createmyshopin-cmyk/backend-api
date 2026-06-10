import { compareSemver, isVersionLessThan, isVersionAtLeast } from './version.util';

describe('version.util', () => {
  it('compares semantic versions', () => {
    expect(compareSemver('2.3.0', '2.2.5')).toBe(1);
    expect(compareSemver('2.2.5', '2.3.0')).toBe(-1);
    expect(compareSemver('2.3.0', '2.3.0')).toBe(0);
  });

  it('detects outdated versions', () => {
    expect(isVersionLessThan('2.2.4', '2.2.5')).toBe(true);
    expect(isVersionLessThan('2.2.5', '2.2.5')).toBe(false);
    expect(isVersionLessThan('2.3.0', '2.2.5')).toBe(false);
  });

  it('checks minimum supported', () => {
    expect(isVersionAtLeast('2.3.0', '2.2.5')).toBe(true);
    expect(isVersionAtLeast('2.2.4', '2.2.5')).toBe(false);
  });

  it('handles v prefix', () => {
    expect(compareSemver('v2.3.0', '2.3.0')).toBe(0);
  });
});
