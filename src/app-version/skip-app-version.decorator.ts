import { SetMetadata } from '@nestjs/common';

export const SKIP_APP_VERSION_KEY = 'skipAppVersion';

/** Skip AppVersionGuard (version check endpoint, health). */
export const SkipAppVersion = () => SetMetadata(SKIP_APP_VERSION_KEY, true);
