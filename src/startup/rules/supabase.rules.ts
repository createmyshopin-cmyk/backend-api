import { PlatformTier } from '../platform-config';
import { fatal, ValidationResult } from '../validation-result';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function validateSupabase(
  env: NodeJS.ProcessEnv,
  tier: PlatformTier,
): ValidationResult {
  const violations = [];
  const url = env.SUPABASE_URL?.trim() ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

  if (!url) {
    violations.push(
      fatal('SB-URL-01', 'SUPABASE_URL is required', 'Set SUPABASE_URL to your Supabase project HTTPS URL'),
    );
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        violations.push(
          fatal('SB-URL-01', 'SUPABASE_URL must be a valid HTTPS URL', 'Use https://YOUR_REF.supabase.co'),
        );
      } else if (
        !parsed.hostname.endsWith('.supabase.co') &&
        !(tier === 'development' && env.SUPABASE_ALLOW_CUSTOM_HOST === 'true')
      ) {
        violations.push(
          fatal(
            'SB-URL-02',
            'SUPABASE_URL host must be *.supabase.co (or set SUPABASE_ALLOW_CUSTOM_HOST=true in development)',
            'Use a standard Supabase project URL',
          ),
        );
      }
    } catch {
      violations.push(
        fatal('SB-URL-01', 'SUPABASE_URL is not a valid URL', 'Set SUPABASE_URL to https://YOUR_REF.supabase.co'),
      );
    }
  }

  if (!key) {
    violations.push(
      fatal(
        'SB-KEY-01',
        'SUPABASE_SERVICE_ROLE_KEY is required',
        'Set SUPABASE_SERVICE_ROLE_KEY from Supabase Dashboard → API',
      ),
    );
  } else {
    if (!key.startsWith('eyJ')) {
      violations.push(
        fatal(
          'SB-KEY-02',
          'SUPABASE_SERVICE_ROLE_KEY must be a JWT (eyJ prefix)',
          'Copy the service_role key from Supabase Dashboard',
        ),
      );
    } else {
      const payload = decodeJwtPayload(key);
      if (!payload || payload.role !== 'service_role') {
        violations.push(
          fatal(
            'SB-KEY-02',
            'SUPABASE_SERVICE_ROLE_KEY JWT role claim must be service_role',
            'Use the service_role key, not the anon key',
          ),
        );
      }
    }
  }

  if (tier !== 'development' && env.FINANCIAL_INMEMORY_FALLBACK_ENABLED === 'true') {
    violations.push(
      fatal(
        'SB-MEM-03',
        'Financial persistence must be supabase in staging/production',
        'Unset FINANCIAL_INMEMORY_FALLBACK_ENABLED',
      ),
    );
  }

  const jwt = env.JWT_SECRET?.trim() ?? '';
  if (key && jwt && key === jwt) {
    violations.push(
      fatal(
        'DIST-01',
        'SUPABASE_SERVICE_ROLE_KEY must differ from JWT_SECRET',
        'Use distinct secrets for Supabase and JWT',
      ),
    );
  }

  return { ok: violations.length === 0, violations, warnings: [] };
}
