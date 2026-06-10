import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  getPlatformConfig,
  getSupabaseProbeCache,
  isStartupValidated,
  mockPaymentsAllowed,
  probeSupabaseReadiness,
} from './startup';

const READINESS_CACHE_MS = 30_000;

@Controller()
export class HealthController {
  @Get()
  root() {
    return { status: 'ok', service: 'voice-calling-api' };
  }

  @Get('health')
  health() {
    if (!isStartupValidated()) {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }
    return { status: 'ok' };
  }

  @Get('health/startup')
  startup() {
    const validated = isStartupValidated();
    if (!validated) {
      throw new ServiceUnavailableException({
        status: 'startup_incomplete',
        validated: false,
      });
    }
    return {
      status: 'started',
      validated: true,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health/ready')
  async ready() {
    if (!isStartupValidated()) {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }

    const cfg = getPlatformConfig();
    const started = Date.now();

    const cache = getSupabaseProbeCache();
    let supabaseOk = cache.ok && cache.ageMs < READINESS_CACHE_MS;
    let supabaseLatencyMs = cache.ok ? cache.ageMs : null;

    if (!supabaseOk) {
      const probeStart = Date.now();
      supabaseOk = await probeSupabaseReadiness(
        cfg.supabase.url,
        cfg.supabase.serviceRoleKey,
      );
      supabaseLatencyMs = Date.now() - probeStart;
    }

    const missing: string[] = [];
    if (!cfg.jwtSecret?.trim()) missing.push('JWT_SECRET');
    if (!cfg.supabase.url?.trim()) missing.push('SUPABASE_URL');
    if (!cfg.supabase.serviceRoleKey?.trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!cfg.agora.appId?.trim()) missing.push('AGORA_APP_ID');

    const mockGuardOk =
      cfg.tier !== 'production' || !mockPaymentsAllowed();

    const checks = {
      supabase: { ok: supabaseOk, latency_ms: supabaseLatencyMs },
      secrets: { ok: missing.length === 0, missing },
      firebase_admin: {
        ok: Boolean(cfg.firebase.projectId && cfg.firebase.clientEmail && cfg.firebase.privateKey),
      },
      platform_tier: { ok: true, value: cfg.tier },
      mock_guard: { ok: mockGuardOk },
    };

    const allOk = Object.values(checks).every((c) => c.ok);

    if (!allOk) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - started,
      });
    }

    return {
      status: 'ready',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
