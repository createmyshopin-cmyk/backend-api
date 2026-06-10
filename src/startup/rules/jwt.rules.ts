import { PlatformTier } from '../platform-config';
import { isKnownWeakSecret } from '../weak-secrets';
import { isStrongSecret } from '../secret-strength';
import { fatal, ValidationResult } from '../validation-result';

export function validateJwt(
  env: NodeJS.ProcessEnv,
  _tier: PlatformTier,
): ValidationResult {
  const violations = [];
  const secret = env.JWT_SECRET?.trim() ?? '';

  if (!secret) {
    violations.push(
      fatal('JWT-01', 'JWT_SECRET is required', 'Set JWT_SECRET in environment (≥32 characters)'),
    );
    return { ok: false, violations, warnings: [] };
  }

  if (!isStrongSecret(secret, { minLength: 32 })) {
    violations.push(
      fatal(
        'JWT-02',
        'JWT_SECRET is missing, too short, or fails strength checks',
        'Generate a cryptographically random secret ≥32 characters',
      ),
    );
  }

  if (isKnownWeakSecret(secret)) {
    violations.push(
      fatal(
        'JWT-03',
        'JWT_SECRET matches a known weak value',
        'Replace JWT_SECRET with a unique strong secret',
      ),
    );
  }

  const invite = env.ADMIN_INVITE_SECRET?.trim() ?? '';
  const webhook = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';

  if (invite && secret === invite) {
    violations.push(
      fatal(
        'JWT-04',
        'JWT_SECRET must not equal ADMIN_INVITE_SECRET',
        'Use distinct values for JWT_SECRET and ADMIN_INVITE_SECRET',
      ),
    );
  }

  if (webhook && secret === webhook) {
    violations.push(
      fatal(
        'JWT-04',
        'JWT_SECRET must not equal RAZORPAY_WEBHOOK_SECRET',
        'Use distinct values for JWT_SECRET and RAZORPAY_WEBHOOK_SECRET',
      ),
    );
  }

  return { ok: violations.length === 0, violations, warnings: [] };
}
