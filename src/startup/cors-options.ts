import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function normalizeCorsOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(normalizeCorsOrigin)
    .filter(Boolean);
}

/** Build Nest CORS options with trailing-slash tolerant origin matching. */
export function buildCorsOptions(corsOrigins: string[]): CorsOptions | undefined {
  const allowed = corsOrigins.map(normalizeCorsOrigin).filter(Boolean);
  if (!allowed.length) return undefined;

  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowed.includes(normalizeCorsOrigin(origin)));
    },
    credentials: true,
  };
}
