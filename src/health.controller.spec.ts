import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import {
  __resetPlatformConfigForTests,
  freezePlatformConfig,
  recordSupabaseProbeResult,
} from './startup/platform-config';

describe('HealthController', () => {
  const controller = new HealthController();

  beforeEach(() => {
    __resetPlatformConfigForTests();
  });

  afterEach(() => {
    __resetPlatformConfigForTests();
  });

  it('returns 503 on /health when startup not validated', () => {
    expect(() => controller.health()).toThrow(ServiceUnavailableException);
  });

  it('returns ok on /health after startup validation', () => {
    freezePlatformConfig({
      tier: 'development',
      jwtSecret: 'x'.repeat(32),
      adminInviteSecret: 'y'.repeat(32),
      supabase: { url: 'https://a.supabase.co', serviceRoleKey: 'key' },
      razorpay: {
        keyId: null,
        keySecret: null,
        webhookSecret: null,
        mockPaymentsAllowed: false,
      },
      firebase: {
        projectId: 'p',
        clientEmail: 'e@p.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nK\n-----END PRIVATE KEY-----',
      },
      agora: { appId: 'id', appCertificate: 'cert', devTokenFallback: null },
      corsOrigins: [],
      financialPersistence: 'supabase',
      nodeEnv: 'development',
      enableSwagger: false,
    });
    recordSupabaseProbeResult(true);
    expect(controller.health()).toEqual({ status: 'ok' });
  });

  it('returns startup status after validation', () => {
    freezePlatformConfig({
      tier: 'development',
      jwtSecret: 'x'.repeat(32),
      adminInviteSecret: 'y'.repeat(32),
      supabase: { url: 'https://a.supabase.co', serviceRoleKey: 'key' },
      razorpay: {
        keyId: null,
        keySecret: null,
        webhookSecret: null,
        mockPaymentsAllowed: false,
      },
      firebase: {
        projectId: 'p',
        clientEmail: 'e@p.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nK\n-----END PRIVATE KEY-----',
      },
      agora: { appId: 'id', appCertificate: 'cert', devTokenFallback: null },
      corsOrigins: [],
      financialPersistence: 'supabase',
      nodeEnv: 'development',
      enableSwagger: false,
    });
    expect(controller.startup()).toMatchObject({ status: 'started', validated: true });
  });

  it('returns ready when supabase probe cache is fresh', async () => {
    freezePlatformConfig({
      tier: 'development',
      jwtSecret: 'x'.repeat(32),
      adminInviteSecret: 'y'.repeat(32),
      supabase: { url: 'https://a.supabase.co', serviceRoleKey: 'key' },
      razorpay: {
        keyId: null,
        keySecret: null,
        webhookSecret: null,
        mockPaymentsAllowed: false,
      },
      firebase: {
        projectId: 'p',
        clientEmail: 'e@p.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nK\n-----END PRIVATE KEY-----',
      },
      agora: { appId: 'id', appCertificate: 'cert', devTokenFallback: null },
      corsOrigins: [],
      financialPersistence: 'supabase',
      nodeEnv: 'development',
      enableSwagger: false,
    });
    recordSupabaseProbeResult(true);
    const ready = await controller.ready();
    expect(ready.status).toBe('ready');
    expect(ready.checks).toBeDefined();
    expect(ready.checks.supabase.ok).toBe(true);
  });
});
