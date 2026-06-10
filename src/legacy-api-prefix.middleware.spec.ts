import { legacyApiPrefixMiddleware } from './legacy-api-prefix.middleware';

describe('legacyApiPrefixMiddleware', () => {
  const next = jest.fn();

  beforeEach(() => next.mockClear());

  it('rewrites /auth/login to /api/auth/login', () => {
    const req = { url: '/auth/login' } as { url: string };
    legacyApiPrefixMiddleware(req as never, {} as never, next);
    expect(req.url).toBe('/api/auth/login');
    expect(next).toHaveBeenCalled();
  });

  it('preserves query string', () => {
    const req = { url: '/auth/login?x=1' } as { url: string };
    legacyApiPrefixMiddleware(req as never, {} as never, next);
    expect(req.url).toBe('/api/auth/login?x=1');
  });

  it('does not rewrite /api/auth/login', () => {
    const req = { url: '/api/auth/login' } as { url: string };
    legacyApiPrefixMiddleware(req as never, {} as never, next);
    expect(req.url).toBe('/api/auth/login');
  });
});
