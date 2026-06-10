import * as path from 'path';
import { freezePlatformConfig, PlatformConfigShape, PlatformTier } from './platform-config';
import { mergeResults, ValidationResult, Violation } from './validation-result';
import { resolveTier, validateTier } from './rules/tier.rules';
import { validateJwt } from './rules/jwt.rules';
import { validateAdminInviteSecret } from './rules/invite.rules';
import { validateSupabase } from './rules/supabase.rules';
import { validateRazorpay } from './rules/razorpay.rules';
import { validateFirebase, resolveFirebaseCredentials } from './rules/firebase.rules';
import { validateAgora } from './rules/agora.rules';
import { validateAntiPatterns } from './rules/anti-pattern.rules';
import { probeSupabase } from './probes/supabase.probe';
import { probeFirebase } from './probes/firebase.probe';
import { probeRazorpay } from './probes/razorpay.probe';
import { probeAgora } from './probes/agora.probe';
import { applyDeployEnvDefaults } from './deploy-env';

export type ServiceProfile = 'admin-backend' | 'api-backend';

export interface StartupValidatorOptions {
  service?: ServiceProfile;
  dryRun?: boolean;
  skipProbes?: boolean;
  env?: NodeJS.ProcessEnv;
  srcRoot?: string;
}

const PROBE_TIMEOUT_MS = 10_000;

function collectPhaseResults(
  env: NodeJS.ProcessEnv,
  tier: PlatformTier | null,
  srcRoot: string,
): ValidationResult {
  const phaseResults: ValidationResult[] = [validateTier(env)];
  if (tier) {
    phaseResults.push(
      validateJwt(env, tier),
      validateAdminInviteSecret(env, tier),
      validateSupabase(env, tier),
      validateRazorpay(env, tier),
      validateFirebase(env, tier, srcRoot),
      validateAgora(env, tier),
      validateAntiPatterns(env, tier, srcRoot),
    );
  }
  return mergeResults(...phaseResults);
}

function buildConfig(env: NodeJS.ProcessEnv, tier: PlatformTier): PlatformConfigShape {
  const firebaseCreds = resolveFirebaseCredentials(env);
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const mockPaymentsAllowed =
    tier === 'development' &&
    env.ALLOW_MOCK_PAYMENTS === 'true' &&
    env.MOCK_PAYMENTS_ENABLED === 'true';

  return {
    tier,
    jwtSecret: env.JWT_SECRET!.trim(),
    adminInviteSecret: env.ADMIN_INVITE_SECRET!.trim(),
    supabase: {
      url: env.SUPABASE_URL!.trim(),
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    },
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID?.trim() || null,
      keySecret: env.RAZORPAY_KEY_SECRET?.trim() || null,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET?.trim() || null,
      mockPaymentsAllowed,
    },
    firebase: firebaseCreds,
    agora: {
      appId: env.AGORA_APP_ID?.trim() ?? '',
      appCertificate: env.AGORA_APP_CERTIFICATE?.trim() || null,
      devTokenFallback:
        tier === 'development' ? env.AGORA_TOKEN?.trim() || null : null,
    },
    corsOrigins,
    financialPersistence: 'supabase',
    nodeEnv: env.NODE_ENV?.trim() ?? 'development',
    enableSwagger: env.ENABLE_SWAGGER === 'true',
  };
}

async function runProbesAsync(
  config: PlatformConfigShape,
  tier: PlatformTier,
): Promise<Violation[]> {
  const probes: Array<{ id: string; run: () => Promise<void> }> = [
    {
      id: 'PROBE-SB-01',
      run: () => probeSupabase(config.supabase.url, config.supabase.serviceRoleKey),
    },
  ];

  if (config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey) {
    probes.push({
      id: 'PROBE-FB-01',
      run: () => probeFirebase(config.firebase),
    });
  }

  if (tier === 'staging' || tier === 'production') {
    if (config.razorpay.keyId && config.razorpay.keySecret) {
      probes.push({
        id: 'PROBE-RZP-01',
        run: () => probeRazorpay(config.razorpay.keyId!, config.razorpay.keySecret!),
      });
    }
    if (config.agora.appId && config.agora.appCertificate) {
      probes.push({
        id: 'PROBE-AGR-01',
        run: () => probeAgora(config.agora.appId, config.agora.appCertificate!),
      });
    }
  }

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('PROBE_TIMEOUT')), PROBE_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      Promise.all(
        probes.map(async (p) => {
          try {
            await p.run();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw Object.assign(new Error(msg), { ruleId: p.id });
          }
        }),
      ),
      timeout,
    ]);
    return [];
  } catch (e) {
    const err = e as Error & { ruleId?: string };
    if (err.message === 'PROBE_TIMEOUT') {
      return [
        {
          ruleId: 'PROBE_TIMEOUT',
          severity: 'fatal',
          message: 'Dependency probes exceeded 10s budget',
          remediation: 'Check Supabase/Firebase/Razorpay/Agora connectivity',
        },
      ];
    }
    return [
      {
        ruleId: err.ruleId ?? 'PROBE_FAILED',
        severity: 'fatal',
        message: `Dependency probe failed: ${err.message}`,
        remediation: 'Verify external service credentials and network access',
      },
    ];
  }
}

function emitFatalAndExit(violations: Violation[]): never {
  for (const v of violations) {
    console.error(
      JSON.stringify({
        event: 'startup_validation_failed',
        rule_id: v.ruleId,
        severity: v.severity,
        message: v.message,
        remediation: v.remediation,
      }),
    );
  }
  process.exit(1);
}

export class StartupValidator {
  /** Synchronous validation without dependency probes (CI dry-run). */
  static dryRun(options: Omit<StartupValidatorOptions, 'dryRun'> = {}): ValidationResult {
    const env = options.env ?? process.env;
    const srcRoot = options.srcRoot ?? path.join(__dirname, '..');
    return collectPhaseResults(env, resolveTier(env), srcRoot);
  }

  /** Async boot gate — runs before NestFactory.create(). */
  static async run(options: StartupValidatorOptions = {}): Promise<PlatformConfigShape> {
    return runStartupValidation(options);
  }
}

export async function runStartupValidation(
  options: StartupValidatorOptions = {},
): Promise<PlatformConfigShape> {
  const env = options.env ?? process.env;
  if (!options.env) {
    applyDeployEnvDefaults(env);
  }
  const srcRoot = options.srcRoot ?? path.join(__dirname, '..');
  const service = options.service ?? 'admin-backend';
  const dryRun = options.dryRun ?? false;
  const skipProbes = options.skipProbes ?? dryRun;

  const tier = resolveTier(env);
  const merged = collectPhaseResults(env, tier, srcRoot);

  for (const w of merged.warnings) {
    console.warn(
      JSON.stringify({
        event: 'startup_validation_warn',
        rule_id: w.ruleId,
        message: w.message,
        remediation: w.remediation,
      }),
    );
  }

  if (!merged.ok || !tier) {
    emitFatalAndExit(merged.violations);
  }

  const strictWarnAsFatal =
    tier === 'production' && env.STRICT_WARN_AS_FATAL === 'true';
  if (strictWarnAsFatal && merged.warnings.length > 0) {
    emitFatalAndExit(
      merged.warnings.map((w) => ({ ...w, severity: 'fatal' as const })),
    );
  }

  const config = buildConfig(env, tier);

  if (!dryRun && !skipProbes) {
    const probeViolations = await runProbesAsync(config, tier);
    if (probeViolations.length > 0) {
      emitFatalAndExit(probeViolations);
    }
  }

  freezePlatformConfig(config);

  console.info(
    JSON.stringify({
      event: 'startup_validation_passed',
      tier,
      service,
      dry_run: dryRun,
    }),
  );

  return config;
}
