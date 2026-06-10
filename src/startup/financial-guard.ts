import { InternalServerErrorException } from '@nestjs/common';
import { getPlatformConfig, isPlatformConfigReady } from './platform-config';

/**
 * Runtime guard — financial code paths must never silently use in-memory stores.
 * Emits structured log for SRE alerting if a legacy mem path is reached.
 */
export function assertFinancialPersistence(context: string): void {
  if (!isPlatformConfigReady()) {
    throw new InternalServerErrorException('Platform not initialized');
  }

  const cfg = getPlatformConfig();
  console.error(
    JSON.stringify({
      event: 'inmemory_fallback_attempted',
      context,
      tier: cfg.tier,
    }),
  );
  throw new InternalServerErrorException(
    'In-memory financial fallback is not permitted',
  );
}
