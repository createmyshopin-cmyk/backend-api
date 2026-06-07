import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveDisplayName } from '../users/users.service';
import admin from '../auth/firebase-admin';

/** Online when last heartbeat was within this window (seconds). */
export const CREATOR_ONLINE_THRESHOLD_SECONDS = 60;

export interface Creator {
  id: string;
  name: string;
  phone: string;
  email: string;
  bio: string;
  languages: string[];
  gender: string;
  experience: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  rating: number;
  completedCalls: number;
  revenueGenerated: number;
  ratePerMinute: number;
  isOnline: boolean;
  lastSeenAt?: string;
  profileImage: string;
  createdAt?: string;
  isNew?: boolean;
}

@Injectable()
export class CreatorsService {
  /** In-memory last_seen when Supabase is unavailable (keyed by user id). */
  private readonly lastSeenByUserId = new Map<string, string>();
  private readonly memEarnings: any[] = [];
  private readonly memWallets: any[] = [];

  private creators: Creator[] = [
    {
      id: 'CRT001',
      name: 'Anjali',
      phone: '+91 91234 56789',
      email: 'anjali@gmail.com',
      bio: 'Compassionate listener and Malayalam language advisor.',
      languages: ['Malayalam'],
      gender: 'Female',
      experience: '2 Years',
      status: 'active',
      rating: 4.8,
      completedCalls: 142,
      revenueGenerated: 8520,
      ratePerMinute: 10,
      isOnline: true,
      profileImage: 'https://i.pravatar.cc/150?u=anjali',
      isNew: true,
    },
    {
      id: 'CRT002',
      name: 'Arjun',
      phone: '+91 92345 67890',
      email: 'arjun@gmail.com',
      bio: 'Certified relationship counselor and counselor.',
      languages: ['Malayalam', 'Tamil'],
      gender: 'Male',
      experience: '3 Years',
      status: 'active',
      rating: 4.9,
      completedCalls: 98,
      revenueGenerated: 7840,
      ratePerMinute: 10,
      isOnline: true,
      profileImage: 'https://i.pravatar.cc/150?u=arjun',
    },
    {
      id: 'CRT003',
      name: 'srevya',
      phone: '+91 93456 78901',
      email: 'srevya@gmail.com',
      bio: 'Empathetic listener and counselor.',
      languages: ['Telugu', 'Hindi'],
      gender: 'Female',
      experience: '1 Year',
      status: 'active',
      rating: 4.5,
      completedCalls: 45,
      revenueGenerated: 2700,
      ratePerMinute: 10,
      isOnline: true,
      profileImage: 'https://i.pravatar.cc/150?u=srevya',
    },
    {
      id: 'CRT004',
      name: 'Karthik',
      phone: '+91 94567 89012',
      email: 'karthik@gmail.com',
      bio: 'Tech advisor by day, listener by night.',
      languages: ['Malayalam', 'Kannada'],
      gender: 'Male',
      experience: '1 Year',
      status: 'active',
      rating: 4.0,
      completedCalls: 0,
      revenueGenerated: 0,
      ratePerMinute: 10,
      isOnline: true,
      profileImage: 'https://i.pravatar.cc/150?u=karthik',
    },
    {
      id: 'CRT005',
      name: 'Sangeetha',
      phone: '+91 95678 90123',
      email: 'sangeetha@gmail.com',
      bio: 'Deep thinker and empathetic listener.',
      languages: ['Malayalam', 'Hindi'],
      gender: 'Female',
      experience: '4 Years',
      status: 'active',
      rating: 4.7,
      completedCalls: 12,
      revenueGenerated: 120,
      ratePerMinute: 10,
      isOnline: true,
      profileImage: 'https://i.pravatar.cc/150?u=sangeetha',
      isNew: true,
    },
  ];

  constructor(private readonly supabase: SupabaseService) {}

  mapToDto(creator: Creator) {
    return {
      id: creator.id,
      name: creator.name,
      language: creator.languages[0] || 'English',
      gender: creator.gender,
      ratePerMinute: creator.ratePerMinute,
      isOnline: creator.isOnline,
      lastSeenAt: creator.lastSeenAt ?? null,
      lastSeenLabel: this.formatLastSeenLabel(creator.lastSeenAt, creator.isOnline),
      profileImage: creator.profileImage,
      isNew: creator.isNew ?? this.isRecentlyJoined(creator.createdAt),
      status: creator.status,
    };
  }

  /** UI copy: "Online" or "Last seen 5 min ago". */
  formatLastSeenLabel(lastSeenAt?: string | null, isOnline?: boolean): string {
    if (isOnline) return 'Online';
    if (!lastSeenAt) return 'Offline';
    const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 1) return 'Last seen just now';
    if (minutes < 60) return `Last seen ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Last seen ${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `Last seen ${days}d ago`;
  }

  private isRecentlyJoined(createdAt?: string): boolean {
    if (!createdAt) return false;
    const created = new Date(createdAt).getTime();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return created >= sevenDaysAgo;
  }

  /** Online when is_online is true and last_seen is within threshold. */
  computeIsOnline(
    lastSeenAt?: string | null,
    onlineStatusFallback?: boolean,
  ): boolean {
    if (!onlineStatusFallback) return false;
    if (!lastSeenAt) return true;
    const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
    return elapsedMs < CREATOR_ONLINE_THRESHOLD_SECONDS * 1000;
  }

  async setOnline(userId: string): Promise<{ ok: true; isOnline: true; lastSeenAt: string }> {
    const now = new Date().toISOString();

    if (this.supabase.isConfigured) {
      await this.assertCreator(userId);

      const { data: updated, error } = await this.supabase
        .getClient()
        .from('creator_profiles')
        .update({
          last_seen_at: now,
          online_status: true,
          is_online: true,
        })
        .eq('user_id', userId)
        .select('last_seen_at, is_online')
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (!updated) throw new ForbiddenException('Creator profile not found');

      return {
        ok: true,
        isOnline: true,
        lastSeenAt: (updated.last_seen_at as string) || now,
      };
    }

    this.lastSeenByUserId.set(userId, now);
    const mem = this.creators.find((c) => c.id === userId);
    if (mem) mem.isOnline = true;
    return { ok: true, isOnline: true, lastSeenAt: now };
  }

  async setOffline(userId: string): Promise<{ ok: true; isOnline: false; lastSeenAt: string }> {
    const now = new Date().toISOString();

    if (this.supabase.isConfigured) {
      await this.assertCreator(userId);

      const { data: updated, error } = await this.supabase
        .getClient()
        .from('creator_profiles')
        .update({
          last_seen_at: now,
          online_status: false,
          is_online: false,
        })
        .eq('user_id', userId)
        .select('last_seen_at, is_online')
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (!updated) throw new ForbiddenException('Creator profile not found');

      return {
        ok: true,
        isOnline: false,
        lastSeenAt: (updated.last_seen_at as string) || now,
      };
    }

    this.lastSeenByUserId.set(userId, now);
    const mem = this.creators.find((c) => c.id === userId);
    if (mem) mem.isOnline = false;
    return { ok: true, isOnline: false, lastSeenAt: now };
  }

  async recordHeartbeat(userId: string): Promise<{ ok: true; lastSeenAt: string }> {
    const now = new Date().toISOString();

    if (this.supabase.isConfigured) {
      await this.assertCreator(userId);

      const { data: profile, error: readErr } = await this.supabase
        .getClient()
        .from('creator_profiles')
        .select('is_online')
        .eq('user_id', userId)
        .maybeSingle();

      if (readErr) throw new BadRequestException(readErr.message);
      if (!profile?.is_online) {
        throw new ForbiddenException('Creator is offline — heartbeat ignored');
      }

      const { data: updated, error } = await this.supabase
        .getClient()
        .from('creator_profiles')
        .update({ last_seen_at: now })
        .eq('user_id', userId)
        .eq('is_online', true)
        .select('last_seen_at')
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (!updated) throw new ForbiddenException('Creator profile not found');

      return { ok: true, lastSeenAt: (updated.last_seen_at as string) || now };
    }

    this.lastSeenByUserId.set(userId, now);
    return { ok: true, lastSeenAt: now };
  }

  private async assertCreator(userId: string): Promise<void> {
    const { data: userRow, error: userErr } = await this.supabase
      .getClient()
      .from('users')
      .select('is_creator')
      .eq('id', userId)
      .maybeSingle();

    if (userErr) throw new BadRequestException(userErr.message);
    if (!userRow?.is_creator) {
      throw new ForbiddenException('Only creators can update presence');
    }
  }

  private async fetchActiveFromSupabase(): Promise<Creator[]> {
    const { data, error } = await this.supabase.getClient().from('users').select(`
        id,
        name,
        full_name,
        email,
        phone,
        gender,
        profile_image,
        status,
        created_at,
        creator_profiles!inner (
          bio,
          languages,
          experience,
          price_per_minute,
          rating,
          total_calls,
          total_earnings,
          online_status,
          is_online,
          last_seen_at
        )
      `)
      .eq('is_creator', true)
      .eq('status', 'active');

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.length) {
      return [];
    }

    return data.map((row: Record<string, unknown>) => {
      const profile = row.creator_profiles as Record<string, unknown> | Record<string, unknown>[];
      const cp = Array.isArray(profile) ? profile[0] : profile;
      const languagesRaw = (cp?.languages as string) || '';
      const languages = languagesRaw
        ? languagesRaw.split(',').map((l) => l.trim()).filter(Boolean)
        : ['English'];
      const createdAt = row.created_at as string | undefined;

      const displayName = resolveDisplayName(
        {
          full_name: row.full_name as string | null,
          name: row.name as string | null,
        },
        'Creator',
      );

      return {
        id: row.id as string,
        name: displayName,
        phone: (row.phone as string) || '',
        email: (row.email as string) || '',
        bio: (cp?.bio as string) || '',
        languages,
        gender: (row.gender as string) || 'Female',
        experience: (cp?.experience as string) || '',
        status: 'active' as const,
        rating: Number(cp?.rating) || 0,
        completedCalls: Number(cp?.total_calls) || 0,
        revenueGenerated: Number(cp?.total_earnings) || 0,
        ratePerMinute: Number(cp?.price_per_minute) || 10,
        lastSeenAt:
          (cp?.last_seen_at as string) || this.lastSeenByUserId.get(row.id as string),
        isOnline: this.computeIsOnline(
          (cp?.last_seen_at as string) || this.lastSeenByUserId.get(row.id as string),
          Boolean(cp?.is_online ?? cp?.online_status),
        ),
        profileImage:
          (row.profile_image as string) ||
          `https://i.pravatar.cc/150?u=${displayName}`,
        createdAt,
        isNew: this.isRecentlyJoined(createdAt),
      };
    });
  }

  async getActive(): Promise<Creator[]> {
    if (this.supabase.isConfigured) {
      try {
        const fromDb = await this.fetchActiveFromSupabase();
        if (fromDb.length > 0) {
          return fromDb;
        }
      } catch (e) {
        console.warn('Supabase creators fetch failed, using in-memory fallback:', (e as Error).message);
      }
    }
    return this.creators.filter((c) => c.status === 'active');
  }

  async getPending() {
    return this.creators.filter((c) => c.status === 'pending');
  }

  async getSuspended() {
    return this.creators.filter((c) => c.status === 'suspended');
  }

  async getRejected() {
    return this.creators.filter((c) => c.status === 'rejected');
  }

  async findOne(id: string) {
    if (this.supabase.isConfigured) {
      try {
        const active = await this.fetchActiveFromSupabase();
        const match = active.find((c) => c.id === id);
        if (match) return match;
      } catch {
        // fall through to in-memory
      }
    }
    const creator = this.creators.find((c) => c.id === id);
    if (!creator) {
      throw new NotFoundException(`Host listener with ID ${id} not found`);
    }
    return creator;
  }

  async apply(userId: string, dto: { name: string; bio: string; languages: string[]; profileImage: string }) {
    const existing = this.creators.find(c => c.id === userId);
    if (existing) {
      throw new BadRequestException('You have already applied or are a creator');
    }

    const newCreator: Creator = {
      id: userId,
      name: dto.name || 'Listener',
      phone: '',
      email: '',
      bio: dto.bio || '',
      languages: dto.languages || ['English'],
      gender: 'Female',
      experience: '1 Year',
      status: 'pending',
      rating: 5.0,
      completedCalls: 0,
      revenueGenerated: 0,
      ratePerMinute: 10,
      isOnline: false,
      profileImage: dto.profileImage || 'https://i.pravatar.cc/150?u=' + userId,
      createdAt: new Date().toISOString(),
    };

    this.creators.push(newCreator);

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        await client.from('creator_profiles').insert({
          user_id: userId,
          bio: dto.bio,
          languages: dto.languages ? dto.languages.join(',') : 'Malayalam',
          experience: '1 Year',
          price_per_minute: 10,
          rating: 5.0,
          online_status: false,
        });
      } catch (e) {
        console.warn('Failed to insert creator_profile into Supabase:', (e as Error).message);
      }
    }

    return {
      success: true,
      message: 'Application submitted successfully',
      creator: this.mapToDto(newCreator),
    };
  }

  async approve(id: string) {
    const creator = await this.findOne(id);
    if (creator.status !== 'pending') {
      throw new BadRequestException('Profile is not in pending state');
    }
    creator.status = 'active';

    // 1. Sync is_creator = true in Supabase (if configured)
    let fcmToken: string | null = null;
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        await client.from('users').update({ is_creator: true }).eq('id', id);
        
        // Fetch user's FCM token to send push notification
        const { data: userRow } = await client
          .from('users')
          .select('fcm_token')
          .eq('id', id)
          .maybeSingle();
        
        if (userRow && userRow.fcm_token) {
          fcmToken = userRow.fcm_token;
        }
      } catch (e) {
        console.warn('Failed to update users.is_creator or fetch FCM token in Supabase:', (e as Error).message);
      }
    }

    // 2. Send push notification to user on approval
    if (fcmToken) {
      try {
        await admin.messaging().send({
          token: fcmToken,
          notification: {
            title: 'Congratulations 🎉',
            body: 'Your listener profile has been approved.\nYou can now receive calls and start earning.',
          },
          android: {
            priority: 'high',
          },
        });
        console.log(`[FCM] Approval push notification sent to user: ${id}`);
      } catch (e) {
        console.warn('[FCM] Send approval notification failed:', (e as Error).message);
      }
    }

    return {
      message: `Host profile ${creator.name} approved successfully`,
      creator,
    };
  }

  async reject(id: string) {
    const creator = await this.findOne(id);
    if (creator.status !== 'pending') {
      throw new BadRequestException('Profile is not in pending state');
    }
    creator.status = 'rejected';
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        await client.from('creator_profiles').delete().eq('user_id', id);
      } catch (e) {
        console.warn('Failed to delete creator_profile on reject in Supabase:', (e as Error).message);
      }
    }
    return {
      message: `Host application for ${creator.name} rejected`,
      creator,
    };
  }

  async suspend(id: string) {
    const creator = await this.findOne(id);
    creator.status = creator.status === 'suspended' ? 'active' : 'suspended';
    return {
      message: `Host profile status toggled to ${creator.status}`,
      creator,
    };
  }

  async recordEarnings(callId: string, creatorId: string, grossAmount: number) {
    let platformCommissionPercent = 30.00; // default 30% commission (creator gets 70%)

    if (this.supabase.isConfigured) {
      try {
        const { data } = await this.supabase
          .getClient()
          .from('app_settings')
          .select('platform_commission_percent')
          .limit(1)
          .maybeSingle();

        if (data && data.platform_commission_percent !== null) {
          platformCommissionPercent = Number(data.platform_commission_percent);
        }
      } catch (e) {
        console.warn('Failed to retrieve platform commission percent from app_settings:', (e as Error).message);
      }
    }

    const platformShare = Number((grossAmount * (platformCommissionPercent / 100)).toFixed(2));
    const creatorShare = Number((grossAmount - platformShare).toFixed(2));

    let record: any;

    if (this.supabase.isConfigured) {
      const client = this.supabase.getClient();

      // Log into creator_earnings ledger table.
      // ON CONFLICT: if the DB unique constraint uq_creator_earnings_call_id fires
      // (concurrent duplicate end-call request), we treat it as idempotent and
      // fetch the already-existing record instead of crashing.
      const { data: earningData, error: earningErr } = await client
        .from('creator_earnings')
        .insert({
          call_id: callId,
          creator_id: creatorId,
          gross_amount: grossAmount,
          creator_share: creatorShare,
          platform_share: platformShare,
        })
        .select('*')
        .single();

      if (earningErr) {
        // Postgres unique-violation code: 23505
        if ((earningErr as any).code === '23505') {
          console.warn(`[recordEarnings] Duplicate earning suppressed for call ${callId} — unique constraint hit.`);
          return; // Exit cleanly; wallet was already credited on the first request.
        }
        throw new Error(`Failed to log creator earning: ${earningErr.message}`);
      }

      record = earningData;

      // Get creator_profile.id to map to creator_wallets.creator_id
      let creatorProfileId = creatorId;
      const { data: profile } = await client
        .from('creator_profiles')
        .select('id')
        .eq('user_id', creatorId)
        .maybeSingle();

      if (profile) {
        creatorProfileId = profile.id;
      }

      // ── Atomic wallet credit ────────────────────────────────────────────────
      // Uses a Postgres UPSERT function (increment_creator_wallet) instead of
      // the previous SELECT → compute → UPDATE pattern, which was NOT safe
      // under concurrent requests (lost-update race condition).
      // The RPC performs: INSERT … ON CONFLICT DO UPDATE (atomic increment).
      const { error: walletErr } = await client.rpc('increment_creator_wallet', {
        p_creator_id: creatorProfileId,
        p_amount: creatorShare,
      });

      if (walletErr) {
        console.warn(
          `Failed to credit creator wallet for profile ${creatorProfileId}:`,
          walletErr.message,
        );
      }

      // Sync total_earnings in creator_profiles as well (non-critical, best-effort)
      try {
        if (profile) {
          await client
            .from('creator_profiles')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', creatorProfileId);
        }
      } catch (e) {
        console.warn('Failed to touch creator_profiles updated_at:', (e as Error).message);
      }
    } else {
      // In-memory fallback
      record = {
        id: `ERN${Date.now().toString().slice(-6)}`,
        callId,
        creatorId,
        grossAmount,
        creatorShare,
        platformShare,
        createdAt: new Date().toISOString(),
      };
      this.memEarnings.unshift(record);

      let wallet = this.memWallets.find(w => w.creatorId === creatorId);
      if (!wallet) {
        wallet = {
          creatorId,
          totalEarned: 0,
          availableBalance: 0,
          withdrawnAmount: 0,
          updatedAt: new Date().toISOString(),
        };
        this.memWallets.push(wallet);
      }

      wallet.totalEarned += creatorShare;
      wallet.availableBalance += creatorShare;
      wallet.updatedAt = new Date().toISOString();

      // Update creator revenue in memory creators list
      const creator = this.creators.find(c => c.id === creatorId);
      if (creator) {
        creator.revenueGenerated += creatorShare;
        creator.completedCalls += 1;
      }
    }

    return record;
  }

  async getEarningsHistory(creatorId: string) {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('creator_earnings')
          .select('*')
          .eq('creator_id', creatorId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(row => ({
            id: row.id,
            callId: row.call_id,
            creatorId: row.creator_id,
            grossAmount: Number(row.gross_amount),
            creatorShare: Number(row.creator_share),
            platformShare: Number(row.platform_share),
            createdAt: row.created_at,
          }));
        }
        console.warn('CreatorsService.getEarningsHistory Supabase error:', error?.message);
      } catch (e) {
        console.warn('CreatorsService.getEarningsHistory exception:', (e as Error).message);
      }
    }

    return this.memEarnings
      .filter(e => e.creatorId === creatorId)
      .map(row => ({
        id: row.id,
        callId: row.callId,
        creatorId: row.creatorId,
        grossAmount: Number(row.grossAmount),
        creatorShare: Number(row.creatorShare),
        platformShare: Number(row.platformShare),
        createdAt: row.createdAt,
      }));
  }

  async getWalletBalance(creatorId: string) {
    if (this.supabase.isConfigured) {
      try {
        let creatorProfileId = creatorId;
        const { data: profile } = await this.supabase.getClient()
          .from('creator_profiles')
          .select('id')
          .eq('user_id', creatorId)
          .maybeSingle();

        if (profile) {
          creatorProfileId = profile.id;
        }

        const { data, error } = await this.supabase
          .getClient()
          .from('creator_wallets')
          .select('*')
          .eq('creator_id', creatorProfileId)
          .maybeSingle();

        if (!error && data) {
          return {
            creatorId,
            totalEarned: Number(data.total_earned),
            availableBalance: Number(data.available_balance),
            withdrawnAmount: Number(data.withdrawn_amount),
            updatedAt: data.updated_at,
          };
        }
      } catch (e) {
        console.warn('CreatorsService.getWalletBalance exception:', (e as Error).message);
      }
    }

    let wallet = this.memWallets.find(w => w.creatorId === creatorId);
    if (!wallet) {
      wallet = {
        creatorId,
        totalEarned: 0,
        availableBalance: 0,
        withdrawnAmount: 0,
        updatedAt: new Date().toISOString(),
      };
      this.memWallets.push(wallet);
    }
    return wallet;
  }

  updateWalletBalanceInMemory(creatorId: string, availableDelta: number, withdrawnDelta: number) {
    let wallet = this.memWallets.find(w => w.creatorId === creatorId);
    if (!wallet) {
      wallet = {
        creatorId,
        totalEarned: 0,
        availableBalance: 0,
        withdrawnAmount: 0,
        updatedAt: new Date().toISOString(),
      };
      this.memWallets.push(wallet);
    }
    wallet.availableBalance += availableDelta;
    wallet.withdrawnAmount += withdrawnDelta;
    wallet.updatedAt = new Date().toISOString();
  }

  getMemCreators(): Creator[] {
    return this.creators;
  }

  getMemEarnings(): any[] {
    return this.memEarnings;
  }
}

