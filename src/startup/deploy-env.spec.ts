import {
  applyDeployEnvDefaults,
  deriveAdminInviteSecret,
  inferPlatformTier,
} from './deploy-env';
import { validateAdminInviteSecret } from './rules/invite.rules';

describe('deploy-env', () => {
  it('infers production on Railway when PLATFORM_TIER is missing', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      RAILWAY_PROJECT_ID: 'proj-123',
    };
    expect(inferPlatformTier(env)).toBe('production');
  });

  it('infers production from RAILWAY_ENVIRONMENT_NAME', () => {
    const env: NodeJS.ProcessEnv = {
      RAILWAY_ENVIRONMENT_NAME: 'production',
    };
    expect(inferPlatformTier(env)).toBe('production');
  });

  it('does not infer tier for local development', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
    };
    expect(inferPlatformTier(env)).toBeNull();
  });

  it('applies PLATFORM_TIER and CORS_ORIGINS defaults on hosted production', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      RAILWAY_SERVICE_ID: 'svc-123',
    };
    applyDeployEnvDefaults(env);
    expect(env.PLATFORM_TIER).toBe('production');
    expect(env.CORS_ORIGINS).toBe('https://admin.creomine.com');
  });

  it('prefers explicit PLATFORM_TIER and CORS_ORIGINS', () => {
    const env: NodeJS.ProcessEnv = {
      PLATFORM_TIER: 'staging',
      CORS_ORIGINS: 'https://staging-admin.example.com',
      RAILWAY_PROJECT_ID: 'proj-123',
    };
    applyDeployEnvDefaults(env);
    expect(env.PLATFORM_TIER).toBe('staging');
    expect(env.CORS_ORIGINS).toBe('https://staging-admin.example.com');
  });

  it('derives ADMIN_INVITE_SECRET from JWT_SECRET on hosted runtime', () => {
    const jwt = 'railway-production-jwt-secret-32chars!!';
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      RAILWAY_PROJECT_ID: 'proj-123',
      JWT_SECRET: jwt,
    };
    applyDeployEnvDefaults(env);
    expect(env.ADMIN_INVITE_SECRET).toBe(deriveAdminInviteSecret(jwt));
    expect(env.ADMIN_INVITE_SECRET).not.toBe(jwt);
    const validation = validateAdminInviteSecret(env, 'production');
    expect(validation.ok).toBe(true);
  });

  it('does not derive ADMIN_INVITE_SECRET locally without Railway', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
      JWT_SECRET: 'local-dev-jwt-secret-32-characters!!',
    };
    applyDeployEnvDefaults(env);
    expect(env.ADMIN_INVITE_SECRET).toBeUndefined();
  });
});
