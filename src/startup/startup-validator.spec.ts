import * as path from 'path';
import {
  StartupValidator,
  runStartupValidation,
  __resetPlatformConfigForTests,
  getPlatformConfig,
} from './index';

const SRC_ROOT = path.join(__dirname, '..');

function baseDevelopmentEnv(): NodeJS.ProcessEnv {
  return {
    PLATFORM_TIER: 'development',
    NODE_ENV: 'development',
    JWT_SECRET: 'unit-test-jwt-secret-32-chars-minimum!!',
    ADMIN_INVITE_SECRET: 'unit-test-invite-secret-32-chars-min!!!',
    SUPABASE_URL: 'https://testproject.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test',
    FIREBASE_PROJECT_ID: 'testproject',
    FIREBASE_CLIENT_EMAIL: 'firebase@testproject.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\nMOCKKEY\n-----END PRIVATE KEY-----',
    AGORA_APP_ID: '0123456789abcdef0123456789abcdef',
    AGORA_APP_CERTIFICATE: 'test-certificate-32chars-minimum-length!!',
  };
}

describe('StartupValidator', () => {
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((
    code?: number,
  ) => {
    throw new Error(`process.exit:${code}`);
  }) as never);

  beforeEach(() => {
    __resetPlatformConfigForTests();
    exitSpy.mockClear();
  });

  afterAll(() => {
    exitSpy.mockRestore();
    __resetPlatformConfigForTests();
  });

  describe('dryRun', () => {
    it('passes with valid development fixture', () => {
      const result = StartupValidator.dryRun({
        env: baseDevelopmentEnv(),
        srcRoot: SRC_ROOT,
      });
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('fails TIER-01 when PLATFORM_TIER is missing', () => {
      const env = { ...baseDevelopmentEnv() };
      delete env.PLATFORM_TIER;
      const result = StartupValidator.dryRun({ env, srcRoot: SRC_ROOT });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.ruleId === 'TIER-01')).toBe(true);
    });

    it('fails JWT-03 on weak JWT_SECRET', () => {
      const env = {
        ...baseDevelopmentEnv(),
        JWT_SECRET: 'change-me-in-production',
      };
      const result = StartupValidator.dryRun({ env, srcRoot: SRC_ROOT });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.ruleId === 'JWT-03')).toBe(true);
    });

    it('fails TIER-03 when mock payments enabled in production', () => {
      const env = {
        ...baseDevelopmentEnv(),
        PLATFORM_TIER: 'production',
        NODE_ENV: 'production',
        ALLOW_MOCK_PAYMENTS: 'true',
        CORS_ORIGINS: 'https://admin.example.com',
        RAZORPAY_KEY_ID: 'rzp_live_testkeyid1234567890',
        RAZORPAY_KEY_SECRET: 'live_secret_16chars_min',
        RAZORPAY_WEBHOOK_SECRET: 'webhook_secret_16chars',
      };
      const result = StartupValidator.dryRun({ env, srcRoot: SRC_ROOT });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.ruleId === 'TIER-03')).toBe(true);
    });

    it('fails DIST-01 when secrets are not distinct', () => {
      const env = {
        ...baseDevelopmentEnv(),
        ADMIN_INVITE_SECRET: 'unit-test-jwt-secret-32-chars-minimum!!',
      };
      const result = StartupValidator.dryRun({ env, srcRoot: SRC_ROOT });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.ruleId.startsWith('INV'))).toBe(
        true,
      );
    });

    it('fails AGR-CERT-02 when AGORA_TOKEN set in production', () => {
      const env = {
        ...baseDevelopmentEnv(),
        PLATFORM_TIER: 'production',
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://admin.example.com',
        AGORA_TOKEN: '007temp',
        RAZORPAY_KEY_ID: 'rzp_live_testkeyid1234567890',
        RAZORPAY_KEY_SECRET: 'live_secret_16chars_min',
        RAZORPAY_WEBHOOK_SECRET: 'webhook_secret_16chars',
      };
      const result = StartupValidator.dryRun({ env, srcRoot: SRC_ROOT });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.ruleId === 'AGR-CERT-02')).toBe(
        true,
      );
    });

    it('fails JWT-05 when auth.module contains default fallback', () => {
      const result = StartupValidator.dryRun({
        env: baseDevelopmentEnv(),
        srcRoot: SRC_ROOT,
      });
      expect(result.violations.some((v) => v.ruleId === 'JWT-05')).toBe(false);
    });

    it('fails HC-01 when password123 remains without dev flag', () => {
      const result = StartupValidator.dryRun({
        env: baseDevelopmentEnv(),
        srcRoot: SRC_ROOT,
      });
      expect(result.violations.some((v) => v.ruleId === 'HC-01')).toBe(false);
    });
  });

  describe('run with skipProbes', () => {
    it('freezes PlatformConfig on success', async () => {
      await runStartupValidation({
        env: baseDevelopmentEnv(),
        srcRoot: SRC_ROOT,
        skipProbes: true,
      });
      const cfg = getPlatformConfig();
      expect(cfg.tier).toBe('development');
      expect(cfg.jwtSecret).toBe('unit-test-jwt-secret-32-chars-minimum!!');
      expect(cfg.financialPersistence).toBe('supabase');
    });

    it('calls process.exit(1) on fatal validation failure', async () => {
      const env = { ...baseDevelopmentEnv() };
      delete env.JWT_SECRET;
      await expect(
        runStartupValidation({ env, srcRoot: SRC_ROOT, skipProbes: true }),
      ).rejects.toThrow('process.exit:1');
    });
  });
});
