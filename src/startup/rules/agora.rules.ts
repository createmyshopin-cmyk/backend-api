import { PlatformTier } from '../platform-config';
import { fatal, ValidationResult } from '../validation-result';

const HEX_32_RE = /^[a-fA-F0-9]{32}$/;

export function validateAgora(
  env: NodeJS.ProcessEnv,
  tier: PlatformTier,
): ValidationResult {
  const violations = [];
  const appId = env.AGORA_APP_ID?.trim() ?? '';
  const certificate = env.AGORA_APP_CERTIFICATE?.trim() ?? '';
  const devToken = env.AGORA_TOKEN?.trim() ?? '';

  if (appId === 'YOUR_AGORA_APP_ID' || appId === 'your_agora_app_id') {
    violations.push(
      fatal('AGR-ID-03', 'AGORA_APP_ID must not be a placeholder value', 'Set real Agora App ID from console'),
    );
  }

  if (tier === 'staging' || tier === 'production') {
    if (!appId) {
      violations.push(
        fatal('AGR-ID-01', 'AGORA_APP_ID is required', 'Set 32-character hex Agora App ID'),
      );
    } else if (!HEX_32_RE.test(appId)) {
      violations.push(
        fatal('AGR-ID-01', 'AGORA_APP_ID must be 32-character hex', 'Copy App ID from Agora Console'),
      );
    }

    if (!certificate || certificate.length < 32) {
      violations.push(
        fatal('AGR-CERT-01', 'AGORA_APP_CERTIFICATE is required (≥32 chars)', 'Enable Primary certificate in Agora Console'),
      );
    }

    if (devToken) {
      violations.push(
        fatal(
          'AGR-CERT-02',
          'AGORA_TOKEN must be unset in staging/production',
          'Remove AGORA_TOKEN and use AGORA_APP_CERTIFICATE',
        ),
      );
    }
  }

  if (tier === 'development') {
    if (!devToken) {
      if (!appId) {
        violations.push(
          fatal('AGR-ID-02', 'AGORA_APP_ID is required when AGORA_TOKEN is not set', 'Set AGORA_APP_ID or AGORA_TOKEN for dev'),
        );
      }
      if (!certificate) {
        violations.push(
          fatal(
            'AGR-CERT-03',
            'AGORA_APP_CERTIFICATE or AGORA_TOKEN required in development',
            'Set certificate for token generation or AGORA_TOKEN for local dev',
          ),
        );
      }
    } else if (certificate) {
      violations.push(
        fatal(
          'AGR-CERT-03',
          'AGORA_TOKEN and AGORA_APP_CERTIFICATE are mutually exclusive in development',
          'Unset AGORA_TOKEN when using certificate-based token generation',
        ),
      );
    }
  }

  if (devToken && tier !== 'development') {
    violations.push(
      fatal('DEV-FB-04', 'AGORA_TOKEN is only allowed in development tier', 'Remove AGORA_TOKEN for staging/production'),
    );
  }

  return { ok: violations.length === 0, violations, warnings: [] };
}
