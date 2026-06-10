import { createClient } from '@supabase/supabase-js';
import { recordSupabaseProbeResult } from '../platform-config';

export async function probeSupabase(url: string, serviceRoleKey: string): Promise<void> {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.from('users').select('id').limit(1);
  if (error && !isBenignProbeError(error.message)) {
    recordSupabaseProbeResult(false);
    throw new Error(`Supabase probe failed: ${error.message}`);
  }
  recordSupabaseProbeResult(true);
}

/** Lightweight readiness re-check (cached by caller). */
export async function probeSupabaseReadiness(
  url: string,
  serviceRoleKey: string,
): Promise<boolean> {
  try {
    await probeSupabase(url, serviceRoleKey);
    return true;
  } catch {
    return false;
  }
}

function isBenignProbeError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('permission denied') ||
    lower.includes('does not exist') ||
    lower.includes('relation') ||
    lower.includes('schema cache')
  );
}
