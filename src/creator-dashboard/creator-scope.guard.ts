import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveDisplayName } from '../users/users.service';
import type { CreatorProfileStatus, CreatorRequestScope } from './creator-dashboard.types';

export interface CreatorAuthenticatedRequest {
  user: { id: string; status?: string };
  creatorScope: CreatorRequestScope;
}

@Injectable()
export class CreatorScopeGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CreatorAuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'unauthorized',
        message: 'Authentication required',
      });
    }

    if (!this.supabase.isConfigured) {
      request.creatorScope = this.inMemoryScope(userId);
      return true;
    }

    const client = this.supabase.getClient();
    const { data: profile, error } = await client
      .from('creator_profiles')
      .select(
        'id, user_id, status, rating, is_online, online_status, created_at, users!inner(id, name, full_name, avatar_url, profile_image, created_at)',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'creator_profile_not_found',
        message: 'Creator profile not found',
      });
    }

    if (!profile) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'creator_profile_not_found',
        message: 'Creator profile not found',
      });
    }

    const row = profile as Record<string, unknown>;
    const status = String(row.status ?? 'active') as CreatorProfileStatus;

    if (status === 'pending' || status === 'rejected') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'creator_not_active',
        message:
          status === 'pending'
            ? 'Creator application is pending approval'
            : 'Creator application was not approved',
      });
    }

    const users = row.users as Record<string, unknown> | Record<string, unknown>[];
    const userRow = Array.isArray(users) ? users[0] : users;

    const { data: freezeRow } = await client
      .from('wallet_freeze_flags')
      .select('frozen')
      .eq('entity_type', 'creator')
      .eq('entity_id', row.id as string)
      .eq('frozen', true)
      .maybeSingle();

    request.creatorScope = {
      userId,
      creatorProfileId: String(row.id),
      profileStatus: status,
      isSuspended: status === 'suspended',
      isWalletFrozen: Boolean(freezeRow?.frozen),
      displayName: resolveDisplayName(userRow ?? {}),
      avatarUrl:
        (userRow?.avatar_url as string) ??
        (userRow?.profile_image as string) ??
        null,
      rating: Number(row.rating ?? 0),
      isOnline: Boolean(row.is_online ?? row.online_status ?? false),
      accountCreatedAt: String(
        (userRow?.created_at as string) ?? row.created_at ?? new Date().toISOString(),
      ),
    };

    return true;
  }

  private inMemoryScope(userId: string): CreatorRequestScope {
    return {
      userId,
      creatorProfileId: `mem-profile-${userId}`,
      profileStatus: 'active',
      isSuspended: false,
      isWalletFrozen: false,
      displayName: 'Creator',
      avatarUrl: null,
      rating: 5,
      isOnline: false,
      accountCreatedAt: new Date().toISOString(),
    };
  }
}
