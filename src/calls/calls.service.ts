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
import { CoinTransactionsService } from './coin-transactions.service';
import {
  ACTIVE_CALL_STATUSES,
  CallLifecycleStatus,
  CallRequestStatus,
  TERMINAL_CALL_STATUSES,
} from './call-status.constants';
import {
  buildCallEndSummary,
  computeCallCoins,
  type CallEndSummary,
} from './call-summary';

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

const computeCoins = computeCallCoins;

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

@Injectable()
export class CallsService {
  /** In-memory fallback when Supabase is unconfigured */
  private memCalls: CallSession[] = [];
  private memCallRequests: CallRequestRecord[] = [];

  constructor(
    private readonly supabase: SupabaseService,
    private readonly usersService: UsersService,
    private readonly creatorsService: CreatorsService,
    private readonly fcmService: FcmService,
    private readonly coinTransactions: CoinTransactionsService,
  ) {}

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
    return this.enrichSessions(rows);
  }

  /** Call history for the authenticated user (caller or creator). */
  async getHistoryForUser(userId: string): Promise<CallSession[]> {
    const rows = await this.fetchHistoryRows(userId);
    return this.enrichSessions(rows);
  }

  private async fetchHistoryRows(userId?: string): Promise<CallSession[]> {
    if (this.supabase.isConfigured) {
      try {
        let query = this.supabase
          .getClient()
          .from('calls')
          .select('*')
          .in('status', TERMINAL_CALL_STATUSES)
          .order('started_at', { ascending: false })
          .limit(100);

        if (userId) {
          query = query.or(`caller_id.eq.${userId},creator_id.eq.${userId}`);
        }

        const { data, error } = await query;
        if (!error && data) {
          return (data as Record<string, unknown>[]).map(rowToSession);
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
    return Promise.all(
      sessions.map(async (session) => {
        let { callerName, creatorName } = session;
        if (!callerName) {
          try {
            callerName = (await this.usersService.findOne(session.callerId)).name;
          } catch {
            callerName = 'Caller';
          }
        }
        if (!creatorName) {
          try {
            creatorName = (await this.usersService.findOne(session.creatorId)).name;
          } catch {
            creatorName = 'Creator';
          }
        }
        return { ...session, callerName, creatorName };
      }),
    );
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
    const token = this._requireAgoraToken(channelName);
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
          .order('created_at', { ascending: true });

        if (!error && data?.length) {
          const rows = data as Record<string, unknown>[];
          const enriched = await Promise.all(
            rows.map(async (row) => {
              let callerName = '';
              let callerAvatar = '';
              try {
                const caller = await this.usersService.findOne(row.caller_id as string);
                callerName = caller.name;
                callerAvatar =
                  (caller as { profileImage?: string }).profileImage ||
                  `https://i.pravatar.cc/150?u=${caller.name}`;
              } catch {
                callerAvatar = 'https://i.pravatar.cc/150?u=caller';
              }
              return {
                id: row.id as string,
                callerId: row.caller_id as string,
                callerName,
                callerAvatar,
                type: row.type as 'voice' | 'video',
                createdAt: row.created_at as string,
              };
            }),
          );
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

  /** POST /calls/requests/:id/missed — ring timeout / no answer */
  async markCallRequestMissed(callRequestId: string, userId: string) {
    const record = await this.findCallRequest(callRequestId);
    if (record.callerId !== userId && record.creatorId !== userId) {
      throw new ForbiddenException('You do not have access to this call request');
    }
    if (record.status !== 'requested' && record.status !== 'accepted') {
      throw new BadRequestException(`Cannot mark as missed when status is ${record.status}`);
    }

    if (this.supabase.isConfigured) {
      try {
        await this.supabase
          .getClient()
          .from('call_requests')
          .update({ status: 'missed' })
          .eq('id', callRequestId);

        if (record.callId) {
          await this.supabase
            .getClient()
            .from('calls')
            .update({ status: 'missed', ended_at: new Date().toISOString() })
            .eq('id', record.callId)
            .in('status', ACTIVE_CALL_STATUSES);
        } else {
          await this.supabase.getClient().from('calls').insert({
            caller_id: record.callerId,
            creator_id: record.creatorId,
            type: record.type,
            status: 'missed',
            channel_name: record.channelName ?? `ch_${Date.now()}`,
            started_at: record.createdAt,
            ended_at: new Date().toISOString(),
            duration_seconds: 0,
            coins_deducted: 0,
            coins_spent: 0,
          });
        }
      } catch (e) {
        console.warn('CallsService.markCallRequestMissed Supabase error:', (e as Error).message);
      }
    }

    record.status = 'missed';
    const memCall = this.memCalls.find((c) => c.id === record.callId);
    if (memCall && ACTIVE_CALL_STATUSES.includes(memCall.status)) {
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

    const role = dto.role ?? 'publisher';
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
          if (userId === callerId || userId === creatorId) return;
          throw new ForbiddenException('You are not a participant in this call');
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
        if (userId === callRow.caller_id || userId === callRow.creator_id) return;
        throw new ForbiddenException('You are not a participant in this call channel');
      }

      const { data: reqRow } = await client
        .from('call_requests')
        .select('caller_id, creator_id, status')
        .eq('channel_name', channelName)
        .eq('status', 'requested')
        .maybeSingle();

      if (reqRow) {
        if (userId === reqRow.caller_id || userId === reqRow.creator_id) return;
        throw new ForbiddenException('You are not a participant in this call channel');
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
        if (memById.callerId === userId || memById.creatorId === userId) return;
        throw new ForbiddenException('You are not a participant in this call');
      }
      throw new NotFoundException(`Call session ${callId} not found`);
    }

    const memCall = this.memCalls.find(
      (c) =>
        c.channelName === channelName &&
        ACTIVE_CALL_STATUSES.includes(c.status),
    );
    if (memCall && (memCall.callerId === userId || memCall.creatorId === userId)) {
      return;
    }

    const memReq = this.memCallRequests.find(
      (r) => r.channelName === channelName && r.status === 'requested',
    );
    if (memReq && (memReq.callerId === userId || memReq.creatorId === userId)) {
      return;
    }

    throw new ForbiddenException('No active call found for this channel');
  }

  private _requireAgoraToken(channelName: string, uid = 0): string {
    const token = this._makeAgoraToken(channelName, uid);
    if (!token) {
      throw new InternalServerErrorException(
        'Agora token unavailable. Set AGORA_APP_CERTIFICATE in .env (enable Primary certificate in Agora Console), or for local dev only set AGORA_TOKEN from Console → your project → Generate temp token.',
      );
    }
    return token;
  }

  private _makeAgoraToken(channelName: string, uid = 0): string {
    const appId = process.env.AGORA_APP_ID?.trim();
    const appCertificate = process.env.AGORA_APP_CERTIFICATE?.trim();
    if (!appId || !appCertificate) {
      const fallback = process.env.AGORA_TOKEN?.trim() ?? '';
      if (fallback) {
        console.warn(
          `[Agora] Using AGORA_TOKEN fallback for channel ${channelName} — token may not match dynamic channels.`,
        );
      }
      return fallback;
    }
    try {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      return RtcTokenBuilder.buildTokenWithUid(
        appId, appCertificate, channelName, uid,
        RtcRole.PUBLISHER, expiresAt, expiresAt,
      );
    } catch (e) {
      console.warn('[Agora] token generation failed:', (e as Error).message);
      return process.env.AGORA_TOKEN?.trim() ?? '';
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
    const giftTotals = await this.fetchGiftTotalsForCall(callId);
    const creatorCallEarnings = await this.fetchCreatorCallEarnings(callId);

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

  // ─── End a call ─────────────────────────────────────────────────────────────

  async endCall(userId: string, callId: string, dto: EndCallDto) {
    const endedAt = new Date().toISOString();

    if (this.supabase.isConfigured) {
      try {
        const { data: callRow, error: fetchErr } = await this.supabase
          .getClient()
          .from('calls')
          .select('id, caller_id, creator_id, type, status, started_at, channel_name')
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
        if (userId !== callerId && userId !== creatorId) {
          throw new ForbiddenException('Only call participants can end this session');
        }

        const callStatus = normalizeCallStatus(row.status as string);
        if (!ACTIVE_CALL_STATUSES.includes(callStatus)) {
          const fullRow = await this.fetchCallRow(callId);
          const summary = await this.assembleCallEndSummary(fullRow, userId);
          const session = rowToSession(fullRow);
          return {
            message: 'Call already ended.',
            alreadyEnded: true,
            callSession: session,
            callRequestStatus: 'accepted' as const,
            coinsDeducted: summary.callCoinsSpent,
            coinsSpent: summary.callCoinsSpent,
            newBalance: summary.remainingBalance,
            ...summary,
          };
        }

        const caller = await this.usersService.findOne(callerId);
        const creator = await this.creatorsService.findOne(creatorId);
        const ratePerMinute = creator.ratePerMinute ?? 10;
        const durationSeconds = this.resolveBillableDuration(
          row.started_at as string | null,
          dto.duration,
        );
        const coinsSpent = computeCoins(durationSeconds, ratePerMinute);
        const balanceBefore = caller.coins;

        await this.supabase
          .getClient()
          .from('calls')
          .update({
            status: 'ended',
            ended_at: endedAt,
            duration_seconds: durationSeconds,
            coins_spent: coinsSpent,
            coins_deducted: coinsSpent,
            ended_reason: dto.endedReason ?? null,
          })
          .eq('id', callId);

        // Ensure this request never surfaces again as "incoming"
        await this.supabase
          .getClient()
          .from('call_requests')
          .update({ status: 'accepted' })
          .eq('call_id', callId)
          .eq('status', 'requested');

        let newBalance: number | undefined;
        try {
          const updatedCaller = await this.usersService.updateCoins(
            row.caller_id as string,
            -coinsSpent,
          );
          newBalance = updatedCaller.coins;

          await this.coinTransactions.recordCallDeduction({
            userId: row.caller_id as string,
            callId,
            coinsSpent,
            balanceBefore,
            balanceAfter: updatedCaller.coins,
            durationSeconds,
          });

          try {
            await this.creatorsService.recordEarnings(callId, row.creator_id as string, coinsSpent);
          } catch (earnErr) {
            console.error('Creator earnings logging failed:', (earnErr as Error).message);
          }
        } catch (e) {
          console.error('Coin deduction failed:', (e as Error).message);
        }


        const session: CallSession = {
          id: callId,
          callerId: row.caller_id as string,
          callerName: caller.name,
          creatorId: row.creator_id as string,
          creatorName: creator.name,
          type: (row.type as 'voice' | 'video') || 'voice',
          status: 'ended',
          durationSeconds,
          coinsDeducted: coinsSpent,
          coinsSpent,
          channelName: (row.channel_name as string) || '',
          startedAt: (row.started_at as string) || '',
          endedAt,
        };

        const memReq = this.memCallRequests.find((r) => r.callId === callId);
        if (memReq) memReq.status = 'accepted';

        this.notifyPeerCallEnded(
          userId,
          callerId,
          creatorId,
          callId,
          memReq?.id,
        );

        const endedRow = {
          ...row,
          status: 'ended',
          ended_at: endedAt,
          duration_seconds: durationSeconds,
          coins_spent: coinsSpent,
          coins_deducted: coinsSpent,
        };
        const summary = await this.assembleCallEndSummary(endedRow, userId);
        if (newBalance != null) {
          summary.remainingBalance = newBalance;
        }

        return {
          message: 'Call ended. Coins deducted successfully.',
          alreadyEnded: false,
          callSession: session,
          callRequestStatus: 'accepted' as const,
          coinsDeducted: coinsSpent,
          coinsSpent,
          newBalance,
          ...summary,
        };
      } catch (e) {
        if (
          e instanceof NotFoundException ||
          e instanceof BadRequestException ||
          e instanceof InternalServerErrorException ||
          e instanceof ForbiddenException
        ) {
          throw e;
        }
        console.warn('CallsService.endCall Supabase error:', (e as Error).message);
      }
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

    const caller = await this.usersService.findOne(mem.callerId);
    const creator = await this.creatorsService.findOne(mem.creatorId);
    const durationSeconds = this.resolveBillableDuration(mem.startedAt, dto.duration);
    const coinsSpent = computeCoins(durationSeconds, creator.ratePerMinute ?? 10);
    const balanceBefore = caller.coins;

    mem.status = 'ended';
    mem.durationSeconds = durationSeconds;
    mem.coinsDeducted = coinsSpent;
    mem.coinsSpent = coinsSpent;
    mem.endedAt = endedAt;

    const memReq = this.memCallRequests.find((r) => r.callId === callId);
    if (memReq) memReq.status = 'accepted';

    this.notifyPeerCallEnded(
      userId,
      mem.callerId,
      mem.creatorId,
      callId,
      memReq?.id,
    );

    let newBalance: number | undefined;
    try {
      const updatedCaller = await this.usersService.updateCoins(mem.callerId, -coinsSpent);
      newBalance = updatedCaller.coins;
      await this.coinTransactions.recordCallDeduction({
        userId: mem.callerId,
        callId,
        coinsSpent,
        balanceBefore,
        balanceAfter: updatedCaller.coins,
        durationSeconds,
      });

      try {
        await this.creatorsService.recordEarnings(callId, mem.creatorId, coinsSpent);
      } catch (earnErr) {
        console.error('In-memory creator earnings logging failed:', (earnErr as Error).message);
      }
    } catch (e) {
      console.error('In-memory coin deduction failed:', (e as Error).message);
    }


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
    if (newBalance != null) {
      summary.remainingBalance = newBalance;
    }

    return {
      message: 'Call ended. Coins deducted successfully.',
      alreadyEnded: false,
      callSession: mem,
      callRequestStatus: 'accepted' as const,
      coinsDeducted: coinsSpent,
      coinsSpent,
      newBalance,
      ...summary,
    };
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

        let callerName = '';
        let creatorName = '';
        try {
          const caller = await this.usersService.findOne((data as Record<string, unknown>).caller_id as string);
          callerName = caller.name;
        } catch {
          /* optional */
        }
        try {
          const creator = await this.creatorsService.findOne(
            (data as Record<string, unknown>).creator_id as string,
          );
          creatorName = creator.name;
        } catch {
          /* optional */
        }

        const record = rowToCallRequest(data as Record<string, unknown>, callerName, creatorName);
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
