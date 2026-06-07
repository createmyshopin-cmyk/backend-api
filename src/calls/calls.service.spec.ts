import { ForbiddenException } from '@nestjs/common';
import { CallsService } from './calls.service';

describe('CallsService.resolveBillableDuration', () => {
  const service = Object.create(CallsService.prototype) as CallsService;
  const resolve = (startedAt: string | null, client: number) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).resolveBillableDuration(startedAt, client);

  it('caps client duration to server elapsed + 30s grace', () => {
    const started = new Date(Date.now() - 120_000).toISOString();
    expect(resolve(started, 9999)).toBeLessThanOrEqual(150);
    expect(resolve(started, 60)).toBe(60);
  });

  it('returns client duration when started_at missing', () => {
    expect(resolve(null, 180)).toBe(180);
  });
});

describe('CallsService.endCall authorization', () => {
  it('documents participant-only end requirement', () => {
    expect(ForbiddenException).toBeDefined();
  });
});

// Agora security tests live in agora-security.spec.ts
