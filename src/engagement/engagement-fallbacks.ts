import { Logger } from '@nestjs/common';

const logger = new Logger('EngagementFallbacks');

export function isMissingEngagementSchema(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return (
    msg.includes('Could not find the function') ||
    msg.includes('schema cache') ||
    /relation .* does not exist/i.test(msg) ||
    /function .* does not exist/i.test(msg)
  );
}

export function logEngagementFallback(label: string, error: unknown): void {
  logger.warn(`${label} unavailable — returning empty defaults: ${(error as Error)?.message ?? error}`);
}
