import { SetMetadata } from '@nestjs/common';
import type { AdminRole } from './admin-roles';

export const ROLES_KEY = 'roles';

/** Declarative endpoint RBAC — caller must hold any one listed role. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
