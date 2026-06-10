export type PlatformTier = 'development' | 'staging' | 'production';

export type FinancialPersistence = 'supabase';

export interface PlatformConfigShape {
  readonly tier: PlatformTier;
  readonly jwtSecret: string;
  readonly adminInviteSecret: string;
  readonly supabase: { url: string; serviceRoleKey: string };
  readonly razorpay: {
    keyId: string | null;
    keySecret: string | null;
    webhookSecret: string | null;
    mockPaymentsAllowed: boolean;
  };
  readonly firebase: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  };
  readonly agora: {
    appId: string;
    appCertificate: string | null;
    devTokenFallback: string | null;
  };
  readonly corsOrigins: string[];
  readonly financialPersistence: FinancialPersistence;
  readonly nodeEnv: string;
  readonly enableSwagger: boolean;
}

let frozenConfig: PlatformConfigShape | null = null;
let startupValidated = false;
let lastSupabaseProbeAt = 0;
let lastSupabaseProbeOk = false;

export function freezePlatformConfig(config: PlatformConfigShape): void {
  if (frozenConfig) {
    throw new Error('PlatformConfig already frozen');
  }
  Object.freeze(config);
  Object.freeze(config.supabase);
  Object.freeze(config.razorpay);
  Object.freeze(config.firebase);
  Object.freeze(config.agora);
  frozenConfig = config;
  startupValidated = true;
}

export function getPlatformConfig(): PlatformConfigShape {
  if (!frozenConfig) {
    throw new Error(
      'PlatformConfig not initialized — StartupValidator must run before accessing config',
    );
  }
  return frozenConfig;
}

export function isPlatformConfigReady(): boolean {
  return startupValidated && frozenConfig !== null;
}

export function markStartupValidated(): void {
  startupValidated = true;
}

export function isStartupValidated(): boolean {
  return startupValidated;
}

export function recordSupabaseProbeResult(ok: boolean): void {
  lastSupabaseProbeAt = Date.now();
  lastSupabaseProbeOk = ok;
}

export function getSupabaseProbeCache(): { ok: boolean; ageMs: number } {
  return {
    ok: lastSupabaseProbeOk,
    ageMs: lastSupabaseProbeAt ? Date.now() - lastSupabaseProbeAt : Number.POSITIVE_INFINITY,
  };
}

export function isDevelopmentTier(): boolean {
  return getPlatformConfig().tier === 'development';
}

export function isStagingTier(): boolean {
  return getPlatformConfig().tier === 'staging';
}

export function isProductionTier(): boolean {
  return getPlatformConfig().tier === 'production';
}

export function mockPaymentsAllowed(): boolean {
  const cfg = getPlatformConfig();
  return cfg.tier === 'development' && cfg.razorpay.mockPaymentsAllowed;
}

/** Reset for unit tests only. */
export function __resetPlatformConfigForTests(): void {
  frozenConfig = null;
  startupValidated = false;
  lastSupabaseProbeAt = 0;
  lastSupabaseProbeOk = false;
}
