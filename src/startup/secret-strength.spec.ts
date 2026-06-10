import { isKnownWeakSecret } from './weak-secrets';
import { isStrongSecret, shannonEntropyBitsPerChar } from './secret-strength';

describe('secret-strength', () => {
  it('rejects known weak secrets', () => {
    expect(isKnownWeakSecret('change-me-in-production')).toBe(true);
    expect(isKnownWeakSecret('password123')).toBe(true);
    expect(isKnownWeakSecret('mockKeySecret')).toBe(true);
  });

  it('accepts strong secrets ≥32 chars', () => {
    expect(
      isStrongSecret('unit-test-jwt-secret-32-chars-minimum!!'),
    ).toBe(true);
  });

  it('rejects short secrets', () => {
    expect(isStrongSecret('short')).toBe(false);
  });

  it('computes entropy for repeated strings', () => {
    expect(shannonEntropyBitsPerChar('aaaaaaaaaa')).toBeLessThan(1);
  });
});
