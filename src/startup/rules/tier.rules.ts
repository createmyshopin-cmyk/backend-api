import { PlatformTier } from '../platform-config';
import { fatal, warn, ValidationResult } from '../validation-result';

const VALID_TIERS: PlatformTier[] = ['development', 'staging', 'production'];

export function validateTier(env: NodeJS.ProcessEnv): ValidationResult {
  const violations = [];
  const warnings = [];

  const raw = env.PLATFORM_TIER?.trim();
  if (!raw || !VALID_TIERS.includes(raw as PlatformTier)) {
    violations.push(
      fatal(
        'TIER-01',
        'PLATFORM_TIER must be exactly development, staging, or production',
        'Set PLATFORM_TIER=development|staging|production in environment',
      ),
    );
    return { ok: false, violations, warnings };
  }

  const tier = raw as PlatformTier;
  const nodeEnv = env.NODE_ENV?.trim() ?? 'development';

  if (tier === 'production' && nodeEnv !== 'production') {
    violations.push(
      fatal(
        'TIER-02',
        'PLATFORM_TIER=production requires NODE_ENV=production',
        'Align NODE_ENV with PLATFORM_TIER or use staging tier',
      ),
    );
  }

  if (tier === 'production' && env.ALLOW_MOCK_PAYMENTS === 'true') {
    violations.push(
      fatal(
        'TIER-03',
        'ALLOW_MOCK_PAYMENTS=true is forbidden when PLATFORM_TIER=production',
        'Unset ALLOW_MOCK_PAYMENTS or use PLATFORM_TIER=development',
      ),
    );
  }

  if (tier === 'staging' && env.ALLOW_MOCK_PAYMENTS === 'true') {
    violations.push(
      fatal(
        'TIER-04',
        'ALLOW_MOCK_PAYMENTS=true is forbidden when PLATFORM_TIER=staging',
        'Unset ALLOW_MOCK_PAYMENTS for staging deployments',
      ),
    );
  }

  if (tier === 'production' && env.ENABLE_SWAGGER === 'true') {
    violations.push(
      fatal(
        'TIER-05',
        'ENABLE_SWAGGER=true is forbidden when PLATFORM_TIER=production',
        'Set ENABLE_SWAGGER=false in production',
      ),
    );
  }

  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (tier === 'production' && corsOrigins.length === 0) {
    violations.push(
      fatal(
        'TIER-06',
        'CORS_ORIGINS must be non-empty when PLATFORM_TIER=production',
        'Set CORS_ORIGINS to an explicit allowlist of admin/app origins',
      ),
    );
  }

  if (
    env.FINANCIAL_INMEMORY_FALLBACK_ENABLED === 'true' &&
    tier !== 'development'
  ) {
    violations.push(
      fatal(
        'TIER-07',
        'FINANCIAL_INMEMORY_FALLBACK_ENABLED=true is only allowed in development',
        'Unset FINANCIAL_INMEMORY_FALLBACK_ENABLED for staging/production',
      ),
    );
  }

  if (tier === 'staging' && corsOrigins.length === 0) {
    warnings.push(
      warn(
        'TIER-WARN-01',
        'CORS_ORIGINS is empty in staging — permissive CORS will apply',
        'Set CORS_ORIGINS for staging admin panel origins',
      ),
    );
  }

  return { ok: violations.length === 0, violations, warnings };
}

export function resolveTier(env: NodeJS.ProcessEnv): PlatformTier | null {
  const raw = env.PLATFORM_TIER?.trim();
  if (!raw || !VALID_TIERS.includes(raw as PlatformTier)) return null;
  return raw as PlatformTier;
}
