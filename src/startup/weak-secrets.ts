/** Known weak secrets — exact and normalized (lowercase, no quotes) match rejected. */
export const KNOWN_WEAK_SECRETS = new Set([
  'change-me-in-production',
  'your-long-random-secret-at-least-32-characters',
  'password',
  'password123',
  'secret',
  'jwt_secret',
  'test',
  'mockkeysecret',
  'rzp_test_mockkeyid',
  '12345678901234567890123456789012',
  'supabase',
  'admin',
]);

export function normalizeSecret(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
}

export function isKnownWeakSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (KNOWN_WEAK_SECRETS.has(trimmed)) return true;
  return KNOWN_WEAK_SECRETS.has(normalizeSecret(trimmed));
}
