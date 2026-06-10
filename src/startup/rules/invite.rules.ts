import { PlatformTier } from '../platform-config';
import { isStrongSecret } from '../secret-strength';
import { fatal, ValidationResult } from '../validation-result';

export function validateAdminInviteSecret(
  env: NodeJS.ProcessEnv,
  _tier: PlatformTier,
): ValidationResult {
  const violations = [];
  const secret = env.ADMIN_INVITE_SECRET?.trim() ?? '';
  const jwt = env.JWT_SECRET?.trim() ?? '';
  const webhook = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';

  if (!secret) {
    violations.push(
      fatal(
        'INV-01',
        'ADMIN_INVITE_SECRET is required',
        'Set ADMIN_INVITE_SECRET (≥32 characters) in environment',
      ),
    );
    return { ok: false, violations, warnings: [] };
  }

  if (!isStrongSecret(secret, { minLength: 32 })) {
    violations.push(
      fatal(
        'INV-01',
        'ADMIN_INVITE_SECRET must be at least 32 characters and strong',
        'Generate a unique ADMIN_INVITE_SECRET ≥32 characters',
      ),
    );
  }

  if (jwt && secret === jwt) {
    violations.push(
      fatal(
        'INV-02',
        'ADMIN_INVITE_SECRET must differ from JWT_SECRET',
        'Use distinct secrets for admin invites and JWT signing',
      ),
    );
  }

  if (webhook && secret === webhook) {
    violations.push(
      fatal(
        'INV-02',
        'ADMIN_INVITE_SECRET must differ from RAZORPAY_WEBHOOK_SECRET',
        'Use distinct secrets for admin invites and Razorpay webhooks',
      ),
    );
  }

  return { ok: violations.length === 0, violations, warnings: [] };
}
