import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersService } from '../users/users.service';
import { CreatorsService } from '../creators/creators.service';
import { FcmService } from '../fcm/fcm.service';
import { EndCallDto } from './dto/call.dto';
import { RequestCallDto } from './dto/call-request.dto';
import { CallRequestActionDto } from './dto/call-action.dto';
import { AgoraTokenDto } from './dto/agora-token.dto';
import { UpdateCallStatusDto } from './dto/update-call-status.dto';
import { CallBillingRpcService } from './call-billing-rpc.service';
import { MissionProgressHook } from '../engagement/mission-progress.hook';
import {
  ACTIVE_CALL_STATUSES,
  CallLifecycleStatus,
  CallRequestStatus,
  TERMINAL_CALL_STATUSES,
} from './call-status.constants';
import {
  buildCallEndSummary,
  type CallEndSummary,
} from './call-summary';
import { getPlatformConfig, isDevelopmentTier } from '../startup/platform-config';
import {
  assertValidCallRoles,
  invalidCallRoleException,
} from './call-role.util';
import { WelcomeCallRewardRpcService } from '../welcome-calls/welcome-call-reward-rpc.service';

// ─── Domain model ───────────────────────────────────────────────────────────

export interface CallSession {
  id: string;
  callerId: string;
  callerName: string;
  creatorId: string;
  creatorName: string;
  type: 'voice' | 'video';
  status: CallLifecycleStatus;
  durationSeconds: number;
  coinsDeducted: number;
  coinsSpent: number;
  channelName: string;
  startedAt: string;
  endedAt?: string;
}

export interface CallRequestRecord {
  id: string;
  callerId: string;
  callerName: string;
  creatorId: string;
  creatorName: string;
  type: 'voice' | 'video';
  status: CallRequestStatus;
  callId?: string;
  channelName?: string;
  createdAt: string;
}

// ─── Coin rate constants ─────────────────────────────────────────────────────

/** Minimum coin balance required to start a call */
const MIN_COINS_TO_CALL = 10;

// ─── Row → domain mapping ────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): CallSession {
  return {
    id: row.id as string,
    callerId: row.caller_id as string,
    callerName: (row.caller_name as string) || '',
    creatorId: row.creator_id as string,
    creatorName: (row.creator_name as string) || '',
    type: (row.type as 'voice' | 'video') || 'voice',
    status: normalizeCallStatus(row.status as string),
    durationSeconds: Number(row.duration_seconds ?? 0),
    coinsDeducted: Number(
      row.coins_spent ?? row.coins_deducted ?? 0,
    ),
    coinsSpent: Number(row.coins_spent ?? row.coins_deducted ?? 0),
    channelName: (row.channel_name as string) || '',
    startedAt: (row.started_at as string) || new Date().toISOString(),
    endedAt: (row.ended_at as string) || undefined,
  };
}

function rowToCallRequest(
  row: Record<string, unknown>,
  callerName = '',
  creatorName = '',
): CallRequestRecord {
  return {
    id: row.id as string,
    callerId: row.caller_id as string,
    callerName: (row.caller_name as string) || callerName,
    creatorId: row.creator_id as string,
    creatorName: (row.creator_name as string) || creatorName,
    type: (row.type as 'voice' | 'video') || 'voice',
    status: normalizeCallRequestStatus(row.status as string),
    callId: (row.call_id as string) || undefined,
    channelName: (row.channel_name as string) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

/** Map legacy DB values to lifecycle statuses for analytics. */
function normalizeCallStatus(raw?: string): CallLifecycleStatus {
  switch (raw) {
    case 'active':
      return 'ongoing';
    case 'completed':
      return 'ended';
    case 'requested':
    case 'accepted':
    case 'ringing':
    case 'ongoing':
    case 'ended':
    case 'missed':
    case 'rejected':
    case 'cancelled':
      return raw;
    default:
      return 'requested';
  }
}

function normalizeCallRequestStatus(raw?: string): CallRequestStatus {
  switch (raw) {
    case 'pending':
      return 'requested';
    case 'completed':
      return 'accepted';
    case 'requested':
    case 'accepted':
    case 'rejected':
    case 'missed':
    case 'cancelled':
      return raw;
    default:
      return 'requested';
  }
}

/** In-process Agora token cache — tokens are valid ~1h; active-call polls must not re-mint. */
type AgoraTokenCacheEntry = { token: string; expiresAtMs: number };

@Injectable()
export class CallsService {
  private readonly agoraTokenCache = new Map<string, AgoraTokenCacheEntry>();
  /** In-memory fallback when Supabase is unconfigured */
  private memCalls: CallSession[] = [];
  private memCallRequests: CallRequestRecord[] = [];

  constructor(
    private readonly supabase: SupabaseService,
    private readonly usersService: UsersService,
    private readonly creatorsService: CreatorsService,
    private readonly fcmService: FcmService,
    private readonly callBillingRpc: CallBillingRpcService,
    private readonly missionHook: MissionProgressHook,
    private readonly welcomeCallRewardRpc: WelcomeCallRewardRpcService,
  ) {}

  /** Enforce User → Creator only (caller.is_creator=false, receiver.is_creator=true). */
  private async enforceCallRoleInvariant(
    callerId: string,
    creatorId: string,
  ): Promise<void> {
    if (callerId === creatorId) {
      throw invalidCallRoleException();
    }
    const [caller, receiver] = await Promise.all([
      this.usersService.findOne(callerId),
      this.usersService.findOne(creatorId),
    ]);
    assertValidCallRoles(caller, receiver);
  }

  private notifyCreatorCallCancelled(
    creatorId: string,
    callRequestId: string,
  ): void {
    this.usersService
      .findOne(creatorId)
      .then((creator) => {
        if (!creator.fcm_token) return;
        return this.fcmService.sendCallCancelled({
          fcmToken: creator.fcm_token,
          callRequestId,
        });
      })
      .catch((e) =>
        console.warn('[FCM] call cancelled notify error:', (e as Error).message),
      );
  }

  private notifyPeerCallEnded(
    endedByUserId: string,
    callerId: string,
    creatorId: string,
    callSessionId: string,
    callRequestId?: string,
  ): void {
    const peerId = endedByUserId === callerId ? creatorId : callerId;
    this.usersService
      .findOne(peerId)
      .then((peer) => {
        if (!peer.fcm_token) return;
        return this.fcmService.sendCallEnded({
          fcmToken: peer.fcm_token,
          callSessionId,
          callRequestId,
        });
      })
      .catch((e) =>
        console.warn('[FCM] call ended notify error:', (e as Error).message),
      );
  }

  // ─── Query ──────────────────────────────────────────────────────────────────

  /** All non-active sessions (admin monitoring). */
  async getHistory(): Promise<CallSession[]> {
    const rows = await this.fetchHistoryRows();
    return this.enrichSessionsIfNeeded(rows);
  }

  /** Call history for the authenticated user (caller or creator). */
  async getHistoryForUser(userId: string): Promise<CallSession[]> {
    const rows = await this.fetchHistoryRows(userId);
    return this.enrichSessionsIfNeeded(rows);
  }

  /** Skips DB round-trips when names were joined in fetchHistoryRows. */
  private async enrichSessionsIfNeeded(sessions: CallSession[]): Promise<CallSession[]> {
    const needsEnrichment = sessions.some((s) => !s.callerName || !s.creatorName);
    if (!needsEnrichment) return sessions;
    return this.enrichSessions(sessions);
  }

  private async fetchHistoryRows(userId?: string): Promise<CallSession[]> {
    if (this.supabase.isConfigured) {
      try {
        let query = this.supabase
          .getClient()
          .from('calls')
          .select(`
            id, caller_id, creator_id, type, status, duration_seconds,
            coins_deducted, coins_spent, channel_name, started_at, ended_at, ended_reason,
            caller:users!calls_caller_id_fkey(name, full_name),
            creator:users!calls_creator_id_fkey(name, full_name)
          `)
          .in('status', TERMINAL_CALL_STATUSES)
          .order('started_at', { ascending: false })
          .limit(100);

        if (userId) {
          query = query.or(`caller_id.eq.${userId},creator_id.eq.${userId}`);
        }

        const { data, error } = await query;
        if (!error && data) {
          return (data as Record<string, unknown>[]).map((row) => {
            const session = rowToSession(row);
            if (!session.callerName) {
              const caller = row.caller as Record<string, unknown> | null;
              session.callerName =
                String(caller?.full_name ?? caller?.name ?? '').trim() || session.callerName;
            }
            if (!session.creatorName) {
              const creator = row.creator as Record<string, unknown> | null;
              session.creatorName =
                String(creator?.full_name ?? creator?.name ?? '').trim() || session.creatorName;
            }
            return session;
          });
        }
        console.warn('CallsService.fetchHistoryRows error:', error?.message);
      } catch (e) {
        console.warn('CallsService.fetchHistoryRows exception:', (e as Error).message);
      }
    }

    let list = this.memCalls.filter(
      (c) => !ACTIVE_CALL_STATUSES.includes(c.status),
    );
    if (userId) {
      list = list.filter(
        (c) => c.callerId === userId || c.creatorId === userId,
      );
    }
    return list;
  }

  private async enrichSessions(sessions: CallSession[]): Promise<CallSession[]> {
    const needsCaller = sessions.filter((s) => !s.callerName).map((s) => s.callerId);
    const needsCreator = sessions.filter((s) => !s.creatorName).map((s) => s.creatorId);
    const userMap = await this.usersService.findManyByIds([...needsCaller, ...needsCreator]);

    return sessions.map((session) => {
      let { callerName, creatorName } = session;
      if (!callerName) {
        callerName = userMap.get(session.callerId)?.name || 'Caller';
      }
      if (!creatorName) {
        creatorName = userMap.get(session.creatorId)?.name || 'Creator';
      }
      return { ...session, callerName, creatorName };
    });
  }

  async getActive(): Promise<CallSession[]> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('calls')
          .select('*')
          .in('status', ACTIVE_CALL_STATUSES)
          .order('started_at', { ascending: false });
        if (!error && data) return (data as Record<string, unknown>[]).map(rowToSession);
        console.warn('CallsService.getActive error:', error?.message);
      } catch (e) {
        console.warn('CallsService.getActive exception:', (e as Error).message);
      }
    }
    return this.memCalls.filter((c) => ACTIVE_CALL_STATUSES.includes(c.status));
  }

  /** Active call for the signed-in caller or creator (resume / cold-start recovery). */
  async getActiveCallForUser(userId: string) {
    let session: CallSession | undefined;

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('calls')
          .select('*')
          .or(`caller_id.eq.${userId},creator_id.eq.${userId}`)
          .in('status', ACTIVE_CALL_STATUSES)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          session = rowToSession(data as Record<string, unknown>);
        } else if (error) {
          console.warn('CallsService.getActiveCallForUser error:', error.message);
        }
      } catch (e) {
        console.warn(
          'CallsService.getActiveCallForUser exception:',
          (e as Error).message,
        );
      }
    }

    if (!session) {
      session = this.memCalls.find(
        (c) =>
          ACTIVE_CALL_STATUSES.includes(c.status) &&
          (c.callerId === userId || c.creatorId === userId),
      );
    }

    if (!session) {
      return { success: true, callSession: null, userId };
    }

    await this.enforceCallRoleInvariant(session.callerId, session.creatorId);

    const isCreator = session.creatorId === userId;
    let peerName = isCreator ? session.callerName : session.creatorName;
    let peerAvatar = `https://i.pravatar.cc/150?u=${isCreator ? session.callerId : session.creatorId}`;
    let coinsPerMinute = 10;

    try {
      if (isCreator) {
        const caller = await this.usersService.findOne(session.callerId);
        peerName = caller.name;
        peerAvatar =
          (caller as { profileImage?: string }).profileImage ?? peerAvatar;
      } else {
        const creator = await this.creatorsService.findOne(session.creatorId);
        peerName = creator.name;
        peerAvatar =
          (creator as { profileImage?: string }).profileImage ?? peerAvatar;
        coinsPerMinute = creator.ratePerMinute ?? 10;
      }
    } catch (e) {
      console.warn('getActiveCallForUser enrich error:', (e as Error).message);
    }

    const channelName = session.channelName;
    const token = this._cachedAgoraToken(channelName);
    const appId = process.env.AGORA_APP_ID?.trim() ?? '';

    return {
      success: true,
      userId,
      callSession: session,
      channelName,
      peerName,
      peerAvatar,
      coinsPerMinute,
      agoraToken: token,
      agoraAppId: appId,
      isCreator,
    };
  }

  /** Auto-close ring requests that were never answered (prevents repeat incoming UI). */
  private async expireStaleCallRequests(): Promise<void> {
    if (!this.supabase.isConfigured) return;
    const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    try {
      await this.supabase
        .getClient()
        .from('call_requests')
        .update({ status: 'missed' })
        .eq('status', 'requested')
        .lt('created_at', cutoff);
    } catch (e) {
      console.warn('expireStaleCallRequests:', (e as Error).message);
    }
  }

  /** Pending incoming requests for the authenticated creator. */
  async getPendingRequestsForCreator(creatorUserId: string) {
    await this.expireStaleCallRequests();

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('call_requests')
          .select('id, caller_id, creator_id, type, status, created_at')
          .eq('creator_id', creatorUserId)
          .eq('status', 'requested')
          .is('call_id', null)
          .order('created_at', { ascending: true });

        if (!error && data?.length) {
          const rows = data as Record<string, unknown>[];
          const callerIds = rows.map((row) => row.caller_id as string);
          const userMap = await this.usersService.findManyByIds(callerIds);
          const enriched = rows.map((row) => {
            const caller = userMap.get(row.caller_id as string);
            const callerName = caller?.name || '';
            const callerAvatar =
              (caller as { profileImage?: string; avatarUrl?: string } | undefined)?.profileImage ||
              (caller as { avatarUrl?: string } | undefined)?.avatarUrl ||
              (callerName ? `https://i.pravatar.cc/150?u=${callerName}` : 'https://i.pravatar.cc/150?u=caller');
            return {
              id: row.id as string,
              callerId: row.caller_id as string,
              callerName,
              callerAvatar,
              type: row.type as 'voice' | 'video',
              createdAt: row.created_at as string,
            };
          });
          return { requests: enriched };
        }
        if (!error) return { requests: [] };
        console.warn('CallsService.getPendingRequestsForCreator error:', error?.message);
      } catch (e) {
        console.warn(
          'CallsService.getPendingRequestsForCreator exception:',
          (e as Error).message,
        );
      }
    }

    const pending = this.memCallRequests.filter(
      (r) => r.creatorId === creatorUserId && r.status === 'requested',
    );
    return {
      requests: pending.map((r) => ({
        id: r.id,
        callerId: r.callerId,
        callerName: r.callerName,
        callerAvatar: `https://i.pravatar.cc/150?u=${r.callerName}`,
        type: r.type,
        createdAt: r.createdAt,
      })),
    };
  }

  /** Poll call request status (caller or creator). */
  async getCallRequestStatus(userId: string, callRequestId: string) {
    const record = await this.findCallRequest(callRequestId);
    if (record.callerId !== userId && record.creatorId !== userId) {
      throw new ForbiddenException('You do not have access to this call request');
    }

    if (record.status === 'accepted' && record.callId) {
      const session = await this.findCallSession(record.callId);
      const channelName = record.channelName ?? session.channelName;
      return {
        status: 'accepted' as const,
        callRequest: record,
        callSession: session,
        channelName,
        agoraToken: this._requireAgoraToken(channelName),
        agoraAppId: process.env.AGORA_APP_ID ?? '',
      };
    }

    return {
      status: record.status,
      callRequest: record,
    };
  }

  // ─── Request a call (pending until creator accepts) ─────────────────────────

  async requestCall(callerId: string, dto: RequestCallDto) {
    const caller = await this.usersService.findOne(callerId);
    const receiverUser = await this.usersService.findOne(dto.listenerId);
    assertValidCallRoles(caller, receiverUser);
    if (callerId === dto.listenerId) {
      throw invalidCallRoleException();
    }

    const creator = await this.creatorsService.findOne(dto.listenerId);

    if (!creator.isOnline) {
      throw new BadRequestException('Listener is currently offline');
    }

    if (caller.coins < MIN_COINS_TO_CALL) {
      throw new BadRequestException(
        `Insufficient coins. You need at least ${MIN_COINS_TO_CALL} coins to start a call.`,
      );
    }

    // Pre-generate channel name so it can be sent in the FCM payload
    const channelName = `ch_${Date.now()}`;
    const createdAt = new Date().toISOString();

    if (this.supabase.isConfigured) {
      try {
        const { data: reqRow, error: reqErr } = await this.supabase
          .getClient()
          .from('call_requests')
          .insert({
            caller_id: callerId,
            creator_id: creator.id,
            type: dto.type,
            status: 'requested',
            channel_name: channelName,
          })
          .select('id, caller_id, creator_id, type, status, channel_name, created_at')
          .single();

        if (reqErr) {
          throw new InternalServerErrorException(
            `Failed to create call request: ${reqErr.message}`,
          );
        }

        const record = rowToCallRequest(
          reqRow as Record<string, unknown>,
          caller.name,
          creator.name,
        );

        // Fetch creator user record to get FCM token, then fire-and-forget
        this.usersService
          .findOne(creator.id)
          .then((creatorUser) => {
            if (!creatorUser.fcm_token) return;
            const callerAvatar = `https://i.pravatar.cc/150?u=${caller.name}`;
            return this.fcmService.sendIncomingCall({
              fcmToken: creatorUser.fcm_token,
              callerName: caller.name,
              callerAvatar,
              channelName,
              callRequestId: record.id,
              agoraToken: this._requireAgoraToken(channelName),
              agoraAppId: process.env.AGORA_APP_ID ?? '',
              callType: dto.type,
            });
          })
          .catch((e) => console.warn('[FCM] requestCall notify error:', (e as Error).message));

        return {
          success: true,
          status: 'requested' as const,
          callRequest: record,
          channelName,
          agoraToken: this._requireAgoraToken(channelName),
          agoraAppId: process.env.AGORA_APP_ID ?? '',
        };
      } catch (e) {
        if (e instanceof InternalServerErrorException) throw e;
        console.warn('CallsService.requestCall Supabase error:', (e as Error).message);
      }
    }

    const record: CallRequestRecord = {
      id: `REQ${Date.now().toString().slice(-8)}`,
      callerId,
      callerName: caller.name,
      creatorId: creator.id,
      creatorName: creator.name,
      type: dto.type,
      status: 'requested',
      channelName,
      createdAt,
    };
    this.memCallRequests.unshift(record);

    return {
      success: true,
      status: 'requested' as const,
      callRequest: record,
      channelName,
          agoraToken: this._requireAgoraToken(channelName),
      agoraAppId: process.env.AGORA_APP_ID ?? '',
    };
  }

  // ─── Creator accepts incoming call ──────────────────────────────────────────

  async acceptCall(creatorUserId: string, dto: CallRequestActionDto) {
    const record = await this.findCallRequest(dto.callId);

    if (record.creatorId !== creatorUserId) {
      throw new ForbiddenException('Only the creator can accept this call');
    }
    if (record.status !== 'requested') {
      throw new BadRequestException(`Call request is already ${record.status}`);
    }

    const caller = await this.usersService.findOne(record.callerId);
    const receiverUser = await this.usersService.findOne(record.creatorId);
    assertValidCallRoles(caller, receiverUser);
    if (!receiverUser.isCreator) {
      throw invalidCallRoleException();
    }

    const creator = await this.creatorsService.findOne(record.creatorId);

    if (caller.coins < MIN_COINS_TO_CALL) {
      throw new BadRequestException('Caller has insufficient coins for this call');
    }

    // Reuse the channel name pre-generated at request time so both sides join the same channel
    const channelName = record.channelName ?? `ch_${Date.now()}`;
    const startedAt = new Date().toISOString();

    if (this.supabase.isConfigured) {
      try {
        const { data: callRow, error: callErr } = await this.supabase
          .getClient()
          .from('calls')
          .insert({
            caller_id: record.callerId,
            creator_id: record.creatorId,
            type: record.type,
            status: 'accepted',
            channel_name: channelName,
            started_at: startedAt,
          })
          .select('id, caller_id, creator_id, type, status, channel_name, started_at')
          .single();

        if (callErr) {
          throw new InternalServerErrorException(
            `Failed to create call session: ${callErr.message}`,
          );
        }

        const callId = (callRow as Record<string, unknown>).id as string;

        await this.supabase
          .getClient()
          .from('call_requests')
          .update({
            status: 'accepted',
            call_id: callId,
          })
          .eq('id', dto.callId);

        const session: CallSession = {
          id: callId,
          callerId: record.callerId,
          callerName: caller.name,
          creatorId: record.creatorId,
          creatorName: creator.name,
          type: record.type,
          status: 'accepted',
          durationSeconds: 0,
          coinsDeducted: 0,
          coinsSpent: 0,
          channelName,
          startedAt,
        };

        return {
          success: true,
          status: 'accepted' as const,
          callRequestId: dto.callId,
          callSession: session,
          channelName,
          agoraToken: this._requireAgoraToken(channelName),
          agoraAppId: process.env.AGORA_APP_ID ?? '',
        };
      } catch (e) {
        if (
          e instanceof InternalServerErrorException ||
          e instanceof BadRequestException ||
          e instanceof ForbiddenException
        ) {
          throw e;
        }
        console.warn('CallsService.acceptCall Supabase error:', (e as Error).message);
      }
    }

    const session: CallSession = {
      id: `CAL${Date.now().toString().slice(-6)}`,
      callerId: record.callerId,
      callerName: caller.name,
      creatorId: record.creatorId,
      creatorName: creator.name,
      type: record.type,
      status: 'accepted',
      durationSeconds: 0,
      coinsDeducted: 0,
      coinsSpent: 0,
      channelName,
      startedAt,
    };
    this.memCalls.unshift(session);

    record.status = 'accepted';
    record.callId = session.id;
    record.channelName = channelName;

    return {
      success: true,
      status: 'accepted' as const,
      callRequestId: dto.callId,
      callSession: session,
      channelName,
          agoraToken: this._requireAgoraToken(channelName),
      agoraAppId: process.env.AGORA_APP_ID ?? '',
    };
  }

  // ─── Creator rejects incoming call ──────────────────────────────────────────

  async rejectCall(creatorUserId: string, dto: CallRequestActionDto) {
    const record = await this.findCallRequest(dto.callId);

    if (record.creatorId !== creatorUserId) {
      throw new ForbiddenException('Only the creator can reject this call');
    }
    if (record.status !== 'requested') {
      throw new BadRequestException(`Call request is already ${record.status}`);
    }

    const endedAt = new Date().toISOString();

    if (this.supabase.isConfigured) {
      try {
        await this.supabase
          .getClient()
          .from('call_requests')
          .update({ status: 'rejected' })
          .eq('id', dto.callId);

        // Write a rejected calls record for history tracking
        await this.supabase
          .getClient()
          .from('calls')
          .insert({
            caller_id: record.callerId,
            creator_id: record.creatorId,
            type: record.type,
            status: 'rejected',
            channel_name: record.channelName ?? `ch_${Date.now()}`,
            started_at: record.createdAt,
            ended_at: endedAt,
            duration_seconds: 0,
            coins_deducted: 0,
            coins_spent: 0,
          });

        return {
          success: true,
          status: 'rejected' as const,
          callId: dto.callId,
        };
      } catch (e) {
        console.warn('CallsService.rejectCall Supabase error:', (e as Error).message);
      }
    }

    record.status = 'rejected';
    this.memCalls.unshift({
      id: `CAL${Date.now().toString().slice(-6)}`,
      callerId: record.callerId,
      callerName: record.callerName,
      creatorId: record.creatorId,
      creatorName: record.creatorName,
      type: record.type,
      status: 'rejected',
      durationSeconds: 0,
      coinsDeducted: 0,
      coinsSpent: 0,
      channelName: record.channelName ?? '',
      startedAt: record.createdAt,
      endedAt,
    });

    return {
      success: true,
      status: 'rejected' as const,
      callId: dto.callId,
    };
  }

  /** PATCH /calls/requests/:id/accept — creator accepts by URL param */
  async acceptCallRequest(callRequestId: string, userId: string) {
    return this.acceptCall(userId, { callId: callRequestId });
  }

  /** PATCH /calls/requests/:id/reject — caller or creator declines while pending */
  async rejectCallRequest(callRequestId: string, userId: string) {
    const record = await this.findCallRequest(callRequestId);
    if (record.callerId !== userId && record.creatorId !== userId) {
      throw new ForbiddenException('You do not have access to this call request');
    }
    if (record.status !== 'requested') {
      throw new BadRequestException(`Call request is already ${record.status}`);
    }

    if (this.supabase.isConfigured) {
      try {
        await this.supabase
          .getClient()
          .from('call_requests')
          .update({ status: 'cancelled' })
          .eq('id', callRequestId);
      } catch (e) {
        console.warn('CallsService.rejectCallRequest Supabase error:', (e as Error).message);
      }
    }

    record.status = 'cancelled';
    this.notifyCreatorCallCancelled(record.creatorId, callRequestId);

    return {
      success: true,
      callRequestStatus: 'cancelled' as const,
      message: 'Call request cancelled.',
    };
  }

  /** POST /calls/requests/:id/missed — ring timeout / no answer (no billing) */
  async markCallRequestMissed(callRequestId: string, userId: string) {
    if (this.supabase.isConfigured) {
      const result = await this.callBillingRpc.markCallRequestMissed({
        callRequestId,
        actorUserId: userId,
      });
      return {
        success: true,
        callRequestStatus: 'missed' as const,
        idempotentReplay: result.idempotentReplay,
        message: result.idempotentReplay
          ? 'Call already marked as missed.'
          : 'Call marked as missed.',
      };
    }

    const record = await this.findCallRequest(callRequestId);
    if (record.callerId !== userId && record.creatorId !== userId) {
      throw new ForbiddenException('You do not have access to this call request');
    }
    if (record.status === 'accepted') {
      throw new ForbiddenException({
        code: 'CALL_ALREADY_ACTIVE',
        message: 'Call is already active — use end call instead of marking missed',
      });
    }
    if (record.status !== 'requested') {
      throw new BadRequestException(`Cannot mark as missed when status is ${record.status}`);
    }

    record.status = 'missed';
    const memCall = this.memCalls.find((c) => c.id === record.callId);
    if (memCall && memCall.status === 'requested') {
      memCall.status = 'missed';
      memCall.endedAt = new Date().toISOString();
    }

    return {
      success: true,
      callRequestStatus: 'missed' as const,
      message: 'Call marked as missed.',
    };
  }

  // ─── Agora Token Generation ──────────────────────────────────────────────────

  async generateAgoraToken(
    userId: string,
    dto: AgoraTokenDto,
  ): Promise<{
    token: string;
    appId: string;
    channelName: string;
    uid: number;
    expiresAt: number;
  }> {
    const channelName = dto.channelName?.trim();
    if (!channelName) {
      throw new BadRequestException('channelName is required');
    }

    await this.assertChannelParticipant(userId, channelName, dto.callId);

    const appId = process.env.AGORA_APP_ID?.trim() ?? '';
    const uid = dto.uid ?? 0;
    const role = dto.role ?? 'publisher';
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    if (!appId) {
      throw new InternalServerErrorException(
        'Agora App ID not configured. Set AGORA_APP_ID in .env',
      );
    }

    const token = this._makeAgoraToken(channelName, uid);
    if (!token) {
      throw new InternalServerErrorException(
        'Agora token unavailable. Set AGORA_APP_CERTIFICATE in .env (enable Primary certificate in Agora Console), or for local dev only set AGORA_TOKEN from Console → your project → Generate temp token.',
      );
    }

    const tokenPreview = token.length > 20 ? token.slice(0, 20) : token;
    console.info(
      `[AgoraToken] CALL_ID=${dto.callId ?? 'null'} CHANNEL_NAME=${channelName} UID=${uid} ROLE=${role} TOKEN_CREATED=${tokenPreview}…`,
    );

    return { token, appId, channelName, uid, expiresAt };
  }

  /**
   * Only callers or creators on an active/ringing call may obtain a channel token.
   */
  async assertChannelParticipant(
    userId: string,
    channelName: string,
    callId?: string,
  ): Promise<void> {
    const finishParticipantCheck = async (
      callerId: string,
      creatorId: string,
    ): Promise<void> => {
      if (userId !== callerId && userId !== creatorId) {
        throw new ForbiddenException('You are not a participant in this call');
      }
      await this.enforceCallRoleInvariant(callerId, creatorId);
    };

    if (this.supabase.isConfigured) {
      const client = this.supabase.getClient();

      if (callId) {
        const { data: callById } = await client
          .from('calls')
          .select('caller_id, creator_id, channel_name, status')
          .eq('id', callId)
          .maybeSingle();

        if (callById) {
          const status = normalizeCallStatus(callById.status as string);
          if (!ACTIVE_CALL_STATUSES.includes(status)) {
            throw new BadRequestException('Call session is not active');
          }
          if ((callById.channel_name as string) !== channelName) {
            throw new ForbiddenException('Channel does not match call session');
          }
          const callerId = callById.caller_id as string;
          const creatorId = callById.creator_id as string;
          await finishParticipantCheck(callerId, creatorId);
          return;
        }

        throw new NotFoundException(`Call session ${callId} not found`);
      }

      const { data: callRow } = await client
        .from('calls')
        .select('caller_id, creator_id, status')
        .eq('channel_name', channelName)
        .in('status', ACTIVE_CALL_STATUSES)
        .maybeSingle();

      if (callRow) {
        await finishParticipantCheck(
          callRow.caller_id as string,
          callRow.creator_id as string,
        );
        return;
      }

      const { data: reqRow } = await client
        .from('call_requests')
        .select('caller_id, creator_id, status')
        .eq('channel_name', channelName)
        .eq('status', 'requested')
        .maybeSingle();

      if (reqRow) {
        await finishParticipantCheck(
          reqRow.caller_id as string,
          reqRow.creator_id as string,
        );
        return;
      }

      throw new ForbiddenException('No active call found for this channel');
    }

    if (callId) {
      const memById = this.memCalls.find((c) => c.id === callId);
      if (memById) {
        if (!ACTIVE_CALL_STATUSES.includes(memById.status)) {
          throw new BadRequestException('Call session is not active');
        }
        if (memById.channelName !== channelName) {
          throw new ForbiddenException('Channel does not match call session');
        }
        await finishParticipantCheck(memById.callerId, memById.creatorId);
        return;
      }
      throw new NotFoundException(`Call session ${callId} not found`);
    }

    const memCall = this.memCalls.find(
      (c) =>
        c.channelName === channelName &&
        ACTIVE_CALL_STATUSES.includes(c.status),
    );
    if (memCall) {
      await finishParticipantCheck(memCall.callerId, memCall.creatorId);
      return;
    }

    const memReq = this.memCallRequests.find(
      (r) => r.channelName === channelName && r.status === 'requested',
    );
    if (memReq) {
      await finishParticipantCheck(memReq.callerId, memReq.creatorId);
      return;
    }

    throw new ForbiddenException('No active call found for this channel');
  }

  /**
   * Internal helper — generates a real Agora token when credentials are
   * available, otherwise falls back to AGORA_TOKEN env var (dev mode).
   */
  /**
   * Inline call payloads must never ship an empty token — clients cannot join without one.
   */
  private _requireAgoraToken(channelName: string, uid = 0): string {
    const token = this._cachedAgoraToken(channelName, uid);
    if (!token) {
      throw new InternalServerErrorException(
        'Agora token unavailable. Set AGORA_APP_CERTIFICATE in .env (enable Primary certificate in Agora Console), or for local dev only set AGORA_TOKEN from Console → Generate temp token.',
      );
    }
    return token;
  }

  private _cachedAgoraToken(channelName: string, uid = 0): string {
    const cacheKey = `${channelName}:${uid}`;
    const now = Date.now();
    const hit = this.agoraTokenCache.get(cacheKey);
    if (hit && hit.expiresAtMs > now + 60_000) {
      return hit.token;
    }
    const token = this._makeAgoraToken(channelName, uid);
    if (token) {
      this.agoraTokenCache.set(cacheKey, { token, expiresAtMs: now + 3_500_000 });
    }
    return token;
  }

  private _makeAgoraToken(channelName: string, uid = 0): string {
    const agora = getPlatformConfig().agora;
    const appId = agora.appId?.trim();
    const appCertificate = agora.appCertificate?.trim();

    if (!appId || !appCertificate) {
      if (isDevelopmentTier() && agora.devTokenFallback) {
        console.warn(
          `[Agora] Using AGORA_TOKEN fallback for channel ${channelName} — token may not match dynamic channels.`,
        );
        return agora.devTokenFallback;
      }
      return '';
    }

    try {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      return RtcTokenBuilder.buildTokenWithUid(
        appId, appCertificate, channelName, uid,
        RtcRole.PUBLISHER, expiresAt, expiresAt,
      );
    } catch (e) {
      console.warn('[Agora] token generation failed:', (e as Error).message);
      if (isDevelopmentTier() && agora.devTokenFallback) {
        return agora.devTokenFallback;
      }
      return '';
    }
  }

  // ─── Lifecycle: ringing / ongoing ───────────────────────────────────────────

  async updateCallStatus(
    userId: string,
    callId: string,
    dto: UpdateCallStatusDto,
  ): Promise<{ success: true; status: string; callSession: CallSession }> {
    const session = await this.findCallSession(callId);
    if (session.callerId !== userId && session.creatorId !== userId) {
      throw new ForbiddenException('You do not have access to this call');
    }
    await this.enforceCallRoleInvariant(session.callerId, session.creatorId);
    if (!ACTIVE_CALL_STATUSES.includes(session.status)) {
      throw new BadRequestException('Call session has already ended');
    }

    const allowed: Record<string, CallLifecycleStatus[]> = {
      ringing: ['accepted', 'ringing'],
      ongoing: ['accepted', 'ringing', 'ongoing'],
    };
    if (!allowed[dto.status].includes(session.status)) {
      throw new BadRequestException(
        `Cannot transition from ${session.status} to ${dto.status}`,
      );
    }

    if (this.supabase.isConfigured) {
      try {
        const { error } = await this.supabase
          .getClient()
          .from('calls')
          .update({ status: dto.status })
          .eq('id', callId);
        if (error) {
          throw new InternalServerErrorException(error.message);
        }
      } catch (e) {
        if (e instanceof InternalServerErrorException) throw e;
        console.warn('CallsService.updateCallStatus Supabase error:', (e as Error).message);
      }
    }

    const mem = this.memCalls.find((c) => c.id === callId);
    if (mem) mem.status = dto.status;

    return {
      success: true,
      status: dto.status,
      callSession: { ...session, status: dto.status },
    };
  }

  // ─── Call summary (source of truth for end-of-call UI) ─────────────────────

  async getCallSummary(userId: string, callId: string): Promise<CallEndSummary> {
    const row = await this.fetchCallRow(callId);
    const callerId = row.caller_id as string;
    const creatorId = row.creator_id as string;
    if (userId !== callerId && userId !== creatorId) {
      throw new ForbiddenException('Only call participants can view this summary');
    }
    return this.assembleCallEndSummary(row, userId);
  }

  private async fetchCallRow(callId: string): Promise<Record<string, unknown>> {
    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('calls')
        .select('*')
        .eq('id', callId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new NotFoundException(`Call session ${callId} not found`);
        }
        throw new InternalServerErrorException(error.message);
      }
      return data as Record<string, unknown>;
    }

    const mem = this.memCalls.find((c) => c.id === callId);
    if (!mem) throw new NotFoundException(`Call session ${callId} not found`);
    return {
      id: mem.id,
      caller_id: mem.callerId,
      creator_id: mem.creatorId,
      duration_seconds: mem.durationSeconds,
      coins_spent: mem.coinsSpent,
      coins_deducted: mem.coinsDeducted,
      status: mem.status,
      started_at: mem.startedAt,
    };
  }

  private async fetchGiftTotalsForCall(callId: string): Promise<{
    giftCoinsSpent: number;
    creatorGiftEarnings: number;
  }> {
    if (!this.supabase.isConfigured) {
      return { giftCoinsSpent: 0, creatorGiftEarnings: 0 };
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('gift_transactions')
      .select('coins_spent, creator_coins')
      .eq('call_id', callId);

    if (error || !data?.length) {
      return { giftCoinsSpent: 0, creatorGiftEarnings: 0 };
    }

    let giftCoinsSpent = 0;
    let creatorGiftEarnings = 0;
    for (const row of data as Record<string, unknown>[]) {
      giftCoinsSpent += Number(row.coins_spent ?? 0);
      creatorGiftEarnings += Number(row.creator_coins ?? 0);
    }
    return { giftCoinsSpent, creatorGiftEarnings };
  }

  private async fetchCreatorCallEarnings(callId: string): Promise<number> {
    if (!this.supabase.isConfigured) return 0;

    const { data } = await this.supabase
      .getClient()
      .from('creator_earnings')
      .select('creator_share')
      .eq('call_id', callId)
      .maybeSingle();

    return Number((data as Record<string, unknown> | null)?.creator_share ?? 0);
  }

  private async assembleCallEndSummary(
    row: Record<string, unknown>,
    viewerUserId: string,
  ): Promise<CallEndSummary> {
    const callId = row.id as string;
    const callerId = row.caller_id as string;
    const callDuration = Number(row.duration_seconds ?? 0);
    const callCoinsSpent = Number(row.coins_spent ?? row.coins_deducted ?? 0);
    const [giftTotals, creatorCallEarnings] = await Promise.all([
      this.fetchGiftTotalsForCall(callId),
      this.fetchCreatorCallEarnings(callId),
    ]);

    let remainingBalance: number | undefined;
    if (viewerUserId === callerId) {
      try {
        const caller = await this.usersService.findOne(callerId);
        remainingBalance = caller.coins;
      } catch {
        /* optional */
      }
    }

    return buildCallEndSummary({
      callDuration,
      callCoinsSpent,
      giftCoinsSpent: giftTotals.giftCoinsSpent,
      creatorCallEarnings,
      creatorGiftEarnings: giftTotals.creatorGiftEarnings,
      remainingBalance,
    });
  }

  /**
   * Ensures no call_requests row for this session can reappear as "incoming".
   * Leaves accepted rows as accepted; cancels any still-requested orphans.
   */
  private async finalizeCallRequestsForEndedSession(callId: string): Promise<string | undefined> {
    if (!this.supabase.isConfigured) {
      const memReq = this.memCallRequests.find((r) => r.callId === callId);
      if (memReq && memReq.status === 'requested') {
        memReq.status = 'cancelled';
      } else if (memReq) {
        memReq.status = 'accepted';
      }
      return memReq?.id;
    }

    try {
      const { data: rows } = await this.supabase
        .getClient()
        .from('call_requests')
        .select('id, status')
        .eq('call_id', callId);

      const linked = (rows ?? []) as { id: string; status: string }[];
      const primaryId = linked[0]?.id;

      if (linked.some((r) => r.status === 'requested')) {
        await this.supabase
          .getClient()
          .from('call_requests')
          .update({ status: 'cancelled' })
          .eq('call_id', callId)
          .eq('status', 'requested');
      }

      for (const memReq of this.memCallRequests.filter((r) => r.callId === callId)) {
        if (memReq.status === 'requested') memReq.status = 'cancelled';
      }

      return primaryId;
    } catch (e) {
      console.warn('finalizeCallRequestsForEndedSession:', (e as Error).message);
      return undefined;
    }
  }

  // ─── End a call ─────────────────────────────────────────────────────────────

  async endCall(
    userId: string,
    callId: string,
    dto: EndCallDto,
    idempotencyKey?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required for end call');
    }

    if (this.supabase.isConfigured) {
      const { data: callRow, error: fetchErr } = await this.supabase
        .getClient()
        .from('calls')
        .select('id, caller_id, creator_id, type, status, started_at, channel_name, ended_at, call_source')
        .eq('id', callId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          throw new NotFoundException(`Call session ${callId} not found`);
        }
        throw new InternalServerErrorException(fetchErr.message);
      }

      const row = callRow as Record<string, unknown>;
      const callerId = row.caller_id as string;
      const creatorId = row.creator_id as string;
      const callSource = (row.call_source as string) ?? 'normal';

      if (userId !== callerId && userId !== creatorId) {
        throw new ForbiddenException('Only call participants can end this session');
      }

      const durationSeconds = this.resolveBillableDuration(
        row.started_at as string | null,
        dto.duration,
      );

      if (callSource === 'welcome') {
        const welcomeResult = await this.welcomeCallRewardRpc.completeWelcomeCall({
          callId,
          actorUserId: userId,
          durationSeconds,
          idempotencyKey,
        });
        const callRequestId = await this.finalizeCallRequestsForEndedSession(callId);
        const caller = await this.usersService.findOne(callerId);
        const alreadyEnded = Boolean(welcomeResult.already_completed);
        return {
          message: alreadyEnded ? 'Call already ended.' : 'Welcome call completed.',
          alreadyEnded,
          idempotentReplay: Boolean(welcomeResult.idempotent_replay),
          callSession: { ...rowToSession(row), status: 'ended' as const },
          callRequestId,
          coinsSpent: 0,
          newBalance: caller.coins,
          welcome: welcomeResult,
        };
      }

      const billing = await this.callBillingRpc.endCallBilling({
        callId,
        actorUserId: userId,
        durationSeconds,
        idempotencyKey,
        endedReason: dto.endedReason,
      });

      if (
        !billing.idempotentReplay &&
        billing.durationSeconds > 0
      ) {
        await this.missionHook.onCallCompleted(userId, callId);
      }

      const caller = await this.usersService.findOne(callerId);
      const creator = await this.creatorsService.findOne(creatorId);
      const endedAt = (row.ended_at as string) || new Date().toISOString();

      const session: CallSession = {
        id: callId,
        callerId,
        callerName: caller.name,
        creatorId,
        creatorName: creator.name,
        type: (row.type as 'voice' | 'video') || 'voice',
        status: 'ended',
        durationSeconds: billing.durationSeconds,
        coinsDeducted: billing.coinsSpent,
        coinsSpent: billing.coinsSpent,
        channelName: (row.channel_name as string) || '',
        startedAt: (row.started_at as string) || '',
        endedAt,
      };

      const callRequestId = await this.finalizeCallRequestsForEndedSession(callId);
      if (!billing.alreadyEnded && !billing.idempotentReplay) {
        this.notifyPeerCallEnded(userId, callerId, creatorId, callId, callRequestId);
      }

      const endedRow = {
        ...row,
        status: 'ended',
        duration_seconds: billing.durationSeconds,
        coins_spent: billing.coinsSpent,
        coins_deducted: billing.coinsSpent,
      };
      const summary = await this.assembleCallEndSummary(endedRow, userId);
      if (billing.balanceAfter != null) {
        summary.remainingBalance = billing.balanceAfter;
      }

      return {
        message: billing.idempotentReplay || billing.alreadyEnded
          ? 'Call already ended.'
          : 'Call ended. Coins deducted successfully.',
        alreadyEnded: billing.alreadyEnded || billing.idempotentReplay,
        idempotentReplay: billing.idempotentReplay,
        callSession: session,
        callRequestId,
        callRequestStatus: 'accepted' as const,
        coinsDeducted: billing.coinsSpent,
        coinsSpent: billing.coinsSpent,
        newBalance: billing.balanceAfter,
        ...summary,
      };
    }

    const mem = this.memCalls.find((c) => c.id === callId);
    if (!mem) throw new NotFoundException(`Call session ${callId} not found`);
    if (userId !== mem.callerId && userId !== mem.creatorId) {
      throw new ForbiddenException('Only call participants can end this session');
    }
    if (!ACTIVE_CALL_STATUSES.includes(mem.status)) {
      const summary = await this.assembleCallEndSummary(
        {
          id: mem.id,
          caller_id: mem.callerId,
          creator_id: mem.creatorId,
          duration_seconds: mem.durationSeconds,
          coins_spent: mem.coinsSpent,
          coins_deducted: mem.coinsDeducted,
          status: mem.status,
          started_at: mem.startedAt,
        },
        userId,
      );
      return {
        message: 'Call already ended.',
        alreadyEnded: true,
        callSession: mem,
        callRequestStatus: 'accepted' as const,
        coinsDeducted: summary.callCoinsSpent,
        coinsSpent: summary.callCoinsSpent,
        newBalance: summary.remainingBalance,
        ...summary,
      };
    }

    throw new BadRequestException(
      'Call billing requires Supabase — configure database for end call settlement',
    );
  }

  /** Caps client-reported duration to server-elapsed time (+30s grace). */
  private resolveBillableDuration(
    startedAt: string | null | undefined,
    clientDurationSeconds: number,
  ): number {
    const reported = Math.max(0, Math.floor(clientDurationSeconds));
    if (!startedAt) return reported;
    const startedMs = Date.parse(startedAt);
    if (Number.isNaN(startedMs)) return reported;
    const elapsed = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    return Math.min(reported, elapsed + 30);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async findCallRequest(callRequestId: string): Promise<CallRequestRecord> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('call_requests')
          .select('*')
          .eq('id', callRequestId)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundException(`Call request ${callRequestId} not found`);
          }
          throw new InternalServerErrorException(error.message);
        }

        const row = data as Record<string, unknown>;
        const callerId = row.caller_id as string;
        const creatorId = row.creator_id as string;
        const userMap = await this.usersService.findManyByIds([callerId, creatorId]);
        const callerName = userMap.get(callerId)?.name ?? '';
        let creatorName = userMap.get(creatorId)?.name ?? '';
        if (!creatorName) {
          try {
            creatorName = (await this.creatorsService.findOne(creatorId)).name;
          } catch {
            /* optional */
          }
        }

        const record = rowToCallRequest(row, callerName, creatorName);
        if (record.callId) {
          const { data: callData } = await this.supabase
            .getClient()
            .from('calls')
            .select('channel_name')
            .eq('id', record.callId)
            .maybeSingle();
          if (callData) {
            record.channelName = (callData as Record<string, unknown>).channel_name as string;
          }
        }
        return record;
      } catch (e) {
        if (e instanceof NotFoundException || e instanceof InternalServerErrorException) {
          throw e;
        }
        console.warn('CallsService.findCallRequest Supabase error:', (e as Error).message);
      }
    }

    const mem = this.memCallRequests.find((r) => r.id === callRequestId);
    if (!mem) throw new NotFoundException(`Call request ${callRequestId} not found`);
    return mem;
  }

  private async findCallSession(callId: string): Promise<CallSession> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('calls')
          .select('*')
          .eq('id', callId)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundException(`Call session ${callId} not found`);
          }
          throw new InternalServerErrorException(error.message);
        }
        return rowToSession(data as Record<string, unknown>);
      } catch (e) {
        if (e instanceof NotFoundException || e instanceof InternalServerErrorException) {
          throw e;
        }
      }
    }

    const mem = this.memCalls.find((c) => c.id === callId);
    if (!mem) throw new NotFoundException(`Call session ${callId} not found`);
    return mem;
  }

  getMemCalls(): CallSession[] {
    return this.memCalls;
  }
}
