import * as fs from 'fs';
import * as path from 'path';
import { PlatformTier } from '../platform-config';
import { fatal, ValidationResult } from '../validation-result';

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function scanSrcFile(srcRoot: string, relative: string): string | null {
  return readIfExists(path.join(srcRoot, relative));
}

export function validateAntiPatterns(
  env: NodeJS.ProcessEnv,
  tier: PlatformTier,
  srcRoot: string,
): ValidationResult {
  const violations = [];

  const authModule = scanSrcFile(srcRoot, 'auth/auth.module.ts');
  if (authModule?.includes("?? 'change-me-in-production'") || authModule?.includes('change-me-in-production')) {
    violations.push(
      fatal(
        'JWT-05',
        'auth.module.ts contains JWT_SECRET string literal fallback',
        'Remove default JWT secret; use PlatformConfig only',
      ),
    );
  }

  const authService = scanSrcFile(srcRoot, 'auth/auth.service.ts');
  if (authService?.includes('password123')) {
    const hardcodedAllowed =
      tier === 'development' && env.HARDCODED_ADMIN_AUTH_ALLOWED === 'true';
    if (!hardcodedAllowed) {
      violations.push(
        fatal(
          'HC-01',
          'Hardcoded admin password detected in auth.service.ts',
          'Remove password123 or set HARDCODED_ADMIN_AUTH_ALLOWED=true in development only',
        ),
      );
    }
  }

  if (
    authService?.includes('admin@coincalling.com') &&
    !(tier === 'development' && env.HARDCODED_ADMIN_AUTH_ALLOWED === 'true')
  ) {
    violations.push(
      fatal(
        'HC-02',
        'Hardcoded admin email detected in auth.service.ts',
        'Use env-based dev admin credentials or database-backed admin_users',
      ),
    );
  }

  const paymentsService = scanSrcFile(srcRoot, 'payments/payments.service.ts');
  if (paymentsService?.includes('rzp_test_mockKeyId')) {
    const hasTierGuard =
      paymentsService.includes('getPlatformConfig') ||
      paymentsService.includes('mockPaymentsAllowed') ||
      paymentsService.includes("tier === 'development'");
    if (!hasTierGuard || tier !== 'development') {
      violations.push(
        fatal(
          'DEV-FB-02',
          'Hardcoded mock Razorpay key ID in payments.service.ts without tier guard',
          'Remove rzp_test_mockKeyId fallback; use PlatformConfig',
        ),
      );
    }
  }

  if (
    paymentsService?.includes('skipping signature check') &&
    tier !== 'development'
  ) {
    const tierGuarded =
      paymentsService.includes('mockPaymentsAllowed') ||
      paymentsService.includes("tier === 'development'");
    if (!tierGuarded) {
      violations.push(
        fatal(
          'DEV-FB-03',
          'Razorpay signature skip path is not tier-gated in payments.service.ts',
          'Gate signature bypass behind PLATFORM_TIER=development only',
        ),
      );
    }
  }

  if (paymentsService?.includes('NODE_ENV') && paymentsService.includes('ALLOW_MOCK_PAYMENTS')) {
    if (!paymentsService.includes('getPlatformConfig') && !paymentsService.includes('mockPaymentsAllowed')) {
      violations.push(
        fatal(
          'DEF-03',
          'Mock payments gated on NODE_ENV instead of PLATFORM_TIER',
          'Use PlatformConfig.tier for mock payment isolation',
        ),
      );
    }
  }

  const callsService = scanSrcFile(srcRoot, 'calls/calls.service.ts');
  if (callsService?.includes('AGORA_TOKEN') && tier !== 'development') {
    const tierGuarded =
      callsService.includes('getPlatformConfig') ||
      callsService.includes('isDevelopmentTier') ||
      callsService.includes("tier === 'development'");
    if (!tierGuarded) {
      violations.push(
        fatal(
          'DEV-FB-05',
          'AGORA_TOKEN fallback in calls.service.ts without tier guard',
          'Gate AGORA_TOKEN fallback to development tier only',
        ),
      );
    }
  }

  const supabaseService = scanSrcFile(srcRoot, 'supabase/supabase.service.ts');
  if (
    (tier === 'staging' || tier === 'production') &&
    supabaseService?.includes('client = null') &&
    !supabaseService?.includes('getPlatformConfig')
  ) {
    violations.push(
      fatal(
        'SB-MEM-01',
        'SupabaseService may construct null client in staging/production',
        'Require Supabase client at boot via PlatformConfig',
      ),
    );
  }

  if (tier !== 'development' && env.FINANCIAL_INMEMORY_FALLBACK_ENABLED === 'true') {
    violations.push(
      fatal('MEM-06', 'FINANCIAL_INMEMORY_FALLBACK_ENABLED=true outside development', 'Unset flag'),
    );
  }

  return { ok: violations.length === 0, violations, warnings: [] };
}
