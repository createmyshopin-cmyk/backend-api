import { isKnownWeakSecret } from './weak-secrets';

/** Shannon entropy in bits per character (heuristic weak passphrase detection). */
export function shannonEntropyBitsPerChar(value: string): number {
  if (!value.length) return 0;
  const freq = new Map<string, number>();
  for (const ch of value) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export interface SecretStrengthOptions {
  minLength?: number;
  minEntropyBitsPerChar?: number;
  entropyCheckBelowLength?: number;
}

export function isStrongSecret(
  value: string | undefined,
  options: SecretStrengthOptions = {},
): boolean {
  const minLength = options.minLength ?? 32;
  const minEntropy = options.minEntropyBitsPerChar ?? 3.5;
  const entropyBelow = options.entropyCheckBelowLength ?? 64;

  if (!value?.trim()) return false;
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  if (isKnownWeakSecret(trimmed)) return false;
  if (
    trimmed.length < entropyBelow &&
    shannonEntropyBitsPerChar(trimmed) < minEntropy
  ) {
    return false;
  }
  return true;
}

export function isDistinctSecret(a: string, b: string): boolean {
  return a.trim() !== b.trim();
}
