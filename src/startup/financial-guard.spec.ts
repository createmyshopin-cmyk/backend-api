import { InternalServerErrorException } from '@nestjs/common';
import { assertFinancialPersistence } from './financial-guard';
import {
  __resetPlatformConfigForTests,
  freezePlatformConfig,
} from './platform-config';

describe('assertFinancialPersistence', () => {
  beforeEach(() => {
    __resetPlatformConfigForTests();
  });

  afterEach(() => {
    __resetPlatformConfigForTests();
  });

  it('throws when platform config is not ready', () => {
    expect(() => assertFinancialPersistence('test')).toThrow(
      InternalServerErrorException,
    );
  });

  it('throws when in-memory path is attempted after boot', () => {
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

    expect(() => assertFinancialPersistence('payments.test')).toThrow(
      InternalServerErrorException,
    );
  });
});
