import { PlatformTier } from '../platform-config';
import { isKnownWeakSecret } from '../weak-secrets';
import { fatal, ValidationResult } from '../validation-result';

export function validateRazorpay(
  env: NodeJS.ProcessEnv,
  tier: PlatformTier,
): ValidationResult {
  const violations = [];
  const keyId = env.RAZORPAY_KEY_ID?.trim() ?? '';
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim() ?? '';
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';
  const jwt = env.JWT_SECRET?.trim() ?? '';

  const mockAllowed =
    tier === 'development' &&
    env.ALLOW_MOCK_PAYMENTS === 'true' &&
    env.MOCK_PAYMENTS_ENABLED === 'true';

  if (tier === 'production') {
    if (!keyId) {
      violations.push(
        fatal('RZP-ID-01', 'RAZORPAY_KEY_ID is required in production', 'Set live Razorpay key ID (rzp_live_*)'),
      );
    } else if (!keyId.startsWith('rzp_live_')) {
      violations.push(
        fatal(
          'RZP-ID-01',
          'RAZORPAY_KEY_ID must start with rzp_live_ in production',
          'Use production Razorpay keys from dashboard',
        ),
      );
    }
    if (keyId.startsWith('rzp_test_')) {
      violations.push(
        fatal('RZP-ID-05', 'Test Razorpay keys are forbidden in production', 'Use rzp_live_* keys'),
      );
    }
  }

  if (tier === 'staging') {
    if (!keyId) {
      violations.push(
        fatal('RZP-ID-02', 'RAZORPAY_KEY_ID is required in staging', 'Set Razorpay test key ID (rzp_test_*)'),
      );
    } else if (!keyId.startsWith('rzp_test_')) {
      violations.push(
        fatal(
          'RZP-ID-02',
          'RAZORPAY_KEY_ID must start with rzp_test_ in staging',
          'Use Razorpay test mode keys for staging',
        ),
      );
    }
  }

  if (tier === 'development' && keyId) {
    if (keyId === 'rzp_test_mockKeyId') {
      violations.push(
        fatal('RZP-ID-04', 'RAZORPAY_KEY_ID must not use hardcoded mock key ID', 'Set a real test key or unset'),
      );
    }
    const liveInDev = keyId.startsWith('rzp_live_');
    if (liveInDev && env.RAZORPAY_ALLOW_LIVE_IN_DEV !== 'true') {
      violations.push(
        fatal(
          'RZP-ID-03',
          'Live Razorpay keys in development require RAZORPAY_ALLOW_LIVE_IN_DEV=true',
          'Use test keys or explicitly allow live keys in dev',
        ),
      );
    }
    if (!keyId.startsWith('rzp_test_') && !liveInDev) {
      violations.push(
        fatal('RZP-ID-03', 'RAZORPAY_KEY_ID format is invalid', 'Use rzp_test_* or rzp_live_* with explicit opt-in'),
      );
    }
  }

  if (keyId === 'rzp_test_mockKeyId') {
    violations.push(
      fatal('RZP-ID-04', 'Hardcoded mock Razorpay key ID detected in environment', 'Remove rzp_test_mockKeyId'),
    );
  }

  if (tier === 'staging' || tier === 'production') {
    if (!keySecret) {
      violations.push(
        fatal('RZP-SEC-01', 'RAZORPAY_KEY_SECRET is required', 'Set RAZORPAY_KEY_SECRET in environment'),
      );
    } else if (keySecret.length < 16) {
      violations.push(
        fatal('RZP-SEC-04', 'RAZORPAY_KEY_SECRET must be at least 16 characters', 'Use the secret from Razorpay dashboard'),
      );
    }

    if (!webhookSecret) {
      violations.push(
        fatal(
          'RZP-WH-01',
          'RAZORPAY_WEBHOOK_SECRET is required in staging/production',
          'Configure webhook secret in Razorpay dashboard and set env var',
        ),
      );
    } else if (webhookSecret.length < 16) {
      violations.push(
        fatal('RZP-WH-02', 'RAZORPAY_WEBHOOK_SECRET must be at least 16 characters', 'Use a strong webhook secret'),
      );
    }
  }

  if (keySecret) {
    if (isKnownWeakSecret(keySecret) || keySecret === 'mockKeySecret') {
      violations.push(
        fatal('RZP-SEC-02', 'RAZORPAY_KEY_SECRET is a known weak value', 'Set a real Razorpay key secret'),
      );
    }
    if (keySecret.length < 16 && (tier === 'staging' || tier === 'production')) {
      violations.push(
        fatal('RZP-SEC-04', 'RAZORPAY_KEY_SECRET must be at least 16 characters', 'Use the secret from Razorpay dashboard'),
      );
    }
    if (jwt && keySecret === jwt) {
      violations.push(
        fatal('DIST-01', 'RAZORPAY_KEY_SECRET must differ from JWT_SECRET', 'Use distinct secrets'),
      );
    }
  } else if ((tier === 'staging' || tier === 'production') && !mockAllowed) {
    violations.push(
      fatal('RZP-SEC-01', 'RAZORPAY_KEY_SECRET is required', 'Set RAZORPAY_KEY_SECRET in environment'),
    );
  } else if (tier === 'development' && !mockAllowed && keyId) {
    violations.push(
      fatal(
        'RZP-SEC-05',
        'RAZORPAY_KEY_SECRET is required when Razorpay keys are set (unless mock payments double opt-in)',
        'Set RAZORPAY_KEY_SECRET or enable ALLOW_MOCK_PAYMENTS + MOCK_PAYMENTS_ENABLED',
      ),
    );
  }

  if (webhookSecret) {
    if (webhookSecret.length < 16) {
      violations.push(
        fatal('RZP-WH-02', 'RAZORPAY_WEBHOOK_SECRET must be at least 16 characters', 'Use a strong webhook secret'),
      );
    }
    if (jwt && webhookSecret === jwt) {
      violations.push(
        fatal('DIST-01', 'RAZORPAY_WEBHOOK_SECRET must differ from JWT_SECRET', 'Use distinct secrets'),
      );
    }
    const invite = env.ADMIN_INVITE_SECRET?.trim() ?? '';
    if (invite && webhookSecret === invite) {
      violations.push(
        fatal('DIST-01', 'RAZORPAY_WEBHOOK_SECRET must differ from ADMIN_INVITE_SECRET', 'Use distinct secrets'),
      );
    }
  }

  if (tier === 'development' && env.ALLOW_MOCK_PAYMENTS === 'true' && env.MOCK_PAYMENTS_ENABLED !== 'true') {
    violations.push(
      fatal(
        'MOCK-03',
        'ALLOW_MOCK_PAYMENTS=true requires MOCK_PAYMENTS_ENABLED=true (double opt-in)',
        'Set MOCK_PAYMENTS_ENABLED=true to enable dev mock payments',
      ),
    );
  }

  return { ok: violations.length === 0, violations, warnings: [] };
}
