import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Skip JwtAuthGuard (login, invite accept). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
