import { PlatformTier } from './platform-config';

const VALID_TIERS: PlatformTier[] = ['development', 'staging', 'production'];

function isHostedRuntime(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.RAILWAY_PROJECT_ID ||
      env.RAILWAY_SERVICE_ID ||
      env.RAILWAY_ENVIRONMENT_NAME ||
      env.RAILWAY_ENVIRONMENT,
  );
}

/** Infer platform tier when PLATFORM_TIER is unset (Railway / PaaS deploys). */
export function inferPlatformTier(env: NodeJS.ProcessEnv): PlatformTier | null {
  const explicit = env.PLATFORM_TIER?.trim();
  if (explicit && VALID_TIERS.includes(explicit as PlatformTier)) {
    return explicit as PlatformTier;
  }

  const railwayName = (
    env.RAILWAY_ENVIRONMENT_NAME ??
    env.RAILWAY_ENVIRONMENT ??
    ''
  )
    .trim()
    .toLowerCase();

  if (railwayName === 'production') return 'production';
  if (railwayName === 'staging' || railwayName === 'preview') return 'staging';

  if (env.NODE_ENV === 'production' && isHostedRuntime(env)) {
    return 'production';
  }

  return null;
}

function inferCorsOrigins(env: NodeJS.ProcessEnv, tier: PlatformTier): string | null {
  const explicit = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (explicit.length > 0) return null;

  const adminPanel = env.ADMIN_PANEL_URL?.trim().replace(/\/$/, '');
  if (adminPanel) return adminPanel;

  if (tier === 'production' && isHostedRuntime(env)) {
    return 'https://admin.creomine.com';
  }

  return null;
}

/**
 * Apply safe defaults for hosted deploys before startup validation.
 * Mutates env in-place (process.env).
 */
export function applyDeployEnvDefaults(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.PLATFORM_TIER?.trim()) {
    const inferred = inferPlatformTier(env);
    if (inferred) {
      env.PLATFORM_TIER = inferred;
      console.warn(
        JSON.stringify({
          event: 'startup_env_default',
          key: 'PLATFORM_TIER',
          value: inferred,
          reason: 'inferred_for_hosted_runtime',
        }),
      );
    }
  }

  const tier = env.PLATFORM_TIER?.trim() as PlatformTier | undefined;
  if (!tier || !VALID_TIERS.includes(tier)) return;

  const corsDefault = inferCorsOrigins(env, tier);
  if (corsDefault) {
    env.CORS_ORIGINS = corsDefault;
    console.warn(
      JSON.stringify({
        event: 'startup_env_default',
        key: 'CORS_ORIGINS',
        value: corsDefault,
        reason: 'production_cors_allowlist',
      }),
    );
  }
}
