import { buildCorsOptions, normalizeCorsOrigin, parseCorsOrigins } from './cors-options';

describe('cors-options', () => {
  it('strips trailing slashes from origins', () => {
    expect(normalizeCorsOrigin('https://admin.creomine.com/')).toBe(
      'https://admin.creomine.com',
    );
  });

  it('parses comma-separated CORS_ORIGINS', () => {
    expect(
      parseCorsOrigins('https://admin.creomine.com/, https://example.com/'),
    ).toEqual(['https://admin.creomine.com', 'https://example.com']);
  });

  it('allows matching origins via callback', () => {
    const options = buildCorsOptions(['https://admin.creomine.com']);
    const originFn = options!.origin as (
      origin: string,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void;

    originFn('https://admin.creomine.com', (_err, allowed) => {
      expect(allowed).toBe(true);
    });

    originFn('https://evil.example.com', (_err, allowed) => {
      expect(allowed).toBe(false);
    });
  });
});
