import type { Request, Response, NextFunction } from 'express';

/**
 * Rewrites /auth/* → /api/auth/* for clients that omit the global API prefix.
 */
export function legacyApiPrefixMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const [pathname, ...queryParts] = req.url.split('?');
  const query = queryParts.length ? `?${queryParts.join('?')}` : '';

  if (
    (pathname === '/auth' || pathname.startsWith('/auth/')) &&
    !pathname.startsWith('/api/')
  ) {
    req.url = `/api${pathname}${query}`;
  }

  next();
}
