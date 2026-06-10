import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CallsService } from '../calls/calls.service';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersService } from '../users/users.service';
import { FcmService } from '../fcm/fcm.service';
import { invalidCallRoleException } from '../calls/call-role.util';
import { UpsertWelcomeCampaignDto } from './dto/welcome-campaign.dto';
import {
  WELCOME_ASSIGNMENT_TTL_MS,
  WelcomeAssignmentStrategy,
} from './welcome-calls.constants';

export interface WelcomeCampaign {
  id: string;
  enabled: boolean;
  rewardCoins: number;
  maxDurationSeconds: number;
  assignmentStrategy: WelcomeAssignmentStrategy;
  createdAt: string;
  updatedAt: string;
}

export interface WelcomeAssignment {
  id: string;
  userId: string;
  campaignId: string;
  creatorProfileId: string;
  status: string;
  rewardCoins: number;
  callId?: string;
  callRequestId?: string;
  expiresAt: string;
  acceptedAt?: string;
  completedAt?: string;
  createdAt: string;
  userDisplayName?: string;
  userAvatarUrl?: string;
}

@Injectable()
export class WelcomeCallsService {
  private memCampaigns: WelcomeCampaign[] = [
    {
      id: 'camp-default',
      enabled: false,
      rewardCoins: 100,
      maxDurationSeconds: 300,
      assignmentStrategy: 'online',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  private memAssignments: WelcomeAssignment[] = [];

  constructor(
    private readonly supabase: SupabaseService,
    private readonly usersService: UsersService,
    private readonly fcmService: FcmService,
    @Inject(forwardRef(() => CallsService))
    private readonly callsService: CallsService,
  ) {}

  // ─── Admin ───────────────────────────────────────────────────

  async listCampaigns(): Promise<{ campaigns: WelcomeCampaign[] }> {
    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('welcome_call_campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        return {
          campaigns: (data as Record<string, unknown>[]).map(this.rowToCampaign),
        };
      }
    }
    return { campaigns: [...this.memCampaigns] };
  }

  async upsertCampaign(dto: UpsertWelcomeCampaignDto): Promise<WelcomeCampaign> {
    const active = await this.getActiveCampaign();
    const payload = {
      enabled: dto.enabled ?? active?.enabled ?? false,
      reward_coins: dto.rewardCoins ?? active?.rewardCoins ?? 100,
      max_duration_seconds: dto.maxDurationSeconds ?? active?.maxDurationSeconds ?? 300,
      assignment_strategy: dto.assignmentStrategy ?? active?.assignmentStrategy ?? 'online',
      updated_at: new Date().toISOString(),
    };

    if (this.supabase.isConfigured) {
      if (active) {
        const { data, error } = await this.supabase
          .getClient()
          .from('welcome_call_campaigns')
          .update(payload)
          .eq('id', active.id)
          .select('*')
          .single();
        if (error) throw new BadRequestException(error.message);
        return this.rowToCampaign(data as Record<string, unknown>);
      }
      const { data, error } = await this.supabase
        .getClient()
        .from('welcome_call_campaigns')
        .insert(payload)
        .select('*')
        .single();
      if (error) throw new BadRequestException(error.message);
      return this.rowToCampaign(data as Record<string, unknown>);
    }

    const camp: WelcomeCampaign = {
      id: active?.id ?? `camp-${Date.now()}`,
      enabled: payload.enabled as boolean,
      rewardCoins: payload.reward_coins as number,
      maxDurationSeconds: payload.max_duration_seconds as number,
      assignmentStrategy: payload.assignment_strategy as WelcomeAssignmentStrategy,
      createdAt: active?.createdAt ?? new Date().toISOString(),
      updatedAt: payload.updated_at as string,
    };
    if (active) {
      const idx = this.memCampaigns.findIndex((c) => c.id === active.id);
      if (idx >= 0) this.memCampaigns[idx] = camp;
      else this.memCampaigns.unshift(camp);
    } else {
      this.memCampaigns.unshift(camp);
    }
    return camp;
  }

  // ─── System: assignment on onboarding ──────────────────────────

  async tryCreateAssignmentForUser(userId: string): Promise<WelcomeAssignment | null> {
    const user = await this.usersService.findOne(userId);
    if (user.isCreator) return null;

    const campaign = await this.getActiveCampaign();
    if (!campaign?.enabled) return null;

    const existing = await this.findAssignmentByUserId(userId);
    if (existing) return null;

    const creatorProfileId = await this.pickCreatorProfile(campaign.assignmentStrategy);
    if (!creatorProfileId) return null;

    const expiresAt = new Date(Date.now() + WELCOME_ASSIGNMENT_TTL_MS).toISOString();
    const record = {
      user_id: userId,
      campaign_id: campaign.id,
      creator_profile_id: creatorProfileId,
      status: 'pending',
      reward_coins: campaign.rewardCoins,
      expires_at: expiresAt,
    };

    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('welcome_call_assignments')
        .insert(record)
        .select('*')
        .single();
      if (error) {
        if (error.code === '23505') return null;
        console.warn('tryCreateAssignmentForUser:', error.message);
        return null;
      }
      return this.rowToAssignment(data as Record<string, unknown>);
    }

    const assignment: WelcomeAssignment = {
      id: `wca-${Date.now()}`,
      userId,
      campaignId: campaign.id,
      creatorProfileId,
      status: 'pending',
      rewardCoins: campaign.rewardCoins,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.memAssignments.unshift(assignment);
    return assignment;
  }

  // ─── Creator ─────────────────────────────────────────────────

  async listPendingForCreator(creatorProfileId: string) {
    await this.expireStaleAssignments();
    const assignments = await this.findPendingForCreator(creatorProfileId);
    const campaign = await this.getActiveCampaign();
    const maxDuration = campaign?.maxDurationSeconds ?? 300;
    return {
      opportunities: assignments.map((a) => ({
        id: a.id,
        rewardCoins: a.rewardCoins,
        expiresAt: a.expiresAt,
        userDisplayName: a.userDisplayName ?? 'New user',
        userAvatarUrl: a.userAvatarUrl,
        maxDurationSeconds: maxDuration,
        status: a.status,
      })),
    };
  }

  async acceptAssignment(
    assignmentId: string,
    creatorProfileId: string,
    creatorUserId: string,
  ) {
    const assignment = await this.findAssignmentById(assignmentId);
    if (!assignment) throw new NotFoundException('Welcome opportunity not found');
    if (assignment.creatorProfileId !== creatorProfileId) {
      throw new ForbiddenException('This opportunity is not assigned to you');
    }
    if (assignment.status !== 'pending') {
      throw new BadRequestException(`Opportunity is already ${assignment.status}`);
    }
    if (new Date(assignment.expiresAt).getTime() < Date.now()) {
      await this.markExpired(assignment.id);
      throw new BadRequestException('Welcome opportunity has expired');
    }

    const user = await this.usersService.findOne(assignment.userId);
    if (user.isCreator) throw invalidCallRoleException();

    const channelName = `welcome_${Date.now()}`;
    const callRequestId = await this.createWelcomeCallRequest({
      callerId: assignment.userId,
      creatorUserId,
      channelName,
      assignmentId: assignment.id,
    });

    await this.updateAssignment(assignment.id, {
      status: 'accepted',
      call_request_id: callRequestId,
      accepted_at: new Date().toISOString(),
    });

    const creatorUser = await this.usersService.findOne(creatorUserId);
    const guideName = creatorUser.name || 'Your Creomine guide';
    const guideAvatar =
      (creatorUser as { avatarUrl?: string }).avatarUrl ??
      `https://i.pravatar.cc/150?u=${guideName}`;

    let agoraToken = '';
    let agoraAppId = process.env.AGORA_APP_ID ?? '';
    try {
      const tokenResult = await this.callsService.generateAgoraToken(creatorUserId, {
        channelName,
        uid: 0,
        role: 'publisher',
      });
      agoraToken = tokenResult.token;
      agoraAppId = tokenResult.appId;
    } catch (e) {
      console.warn('[WelcomeCall] Agora token:', (e as Error).message);
    }

    if (user.fcm_token) {
      await this.fcmService.sendWelcomeIncomingCall({
        fcmToken: user.fcm_token,
        guideName,
        guideAvatar,
        channelName,
        callRequestId,
        agoraToken,
        agoraAppId,
        rewardCoins: assignment.rewardCoins,
        assignmentId: assignment.id,
        guideUserId: creatorUserId,
      });
    }

    return {
      success: true,
      assignmentId: assignment.id,
      callRequestId,
      channelName,
      message: 'Welcome call initiated — user is being notified',
    };
  }

  async rejectAssignment(assignmentId: string, creatorProfileId: string) {
    const assignment = await this.findAssignmentById(assignmentId);
    if (!assignment) throw new NotFoundException('Welcome opportunity not found');
    if (assignment.creatorProfileId !== creatorProfileId) {
      throw new ForbiddenException('This opportunity is not assigned to you');
    }
    if (assignment.status !== 'pending') {
      throw new BadRequestException(`Opportunity is already ${assignment.status}`);
    }
    await this.updateAssignment(assignment.id, { status: 'cancelled' });
    return { success: true, status: 'cancelled' };
  }

  // ─── User joins welcome call ───────────────────────────────────

  async userJoinWelcomeCall(userId: string, callRequestId: string) {
    const user = await this.usersService.findOne(userId);
    if (user.isCreator) throw invalidCallRoleException();

    const req = await this.findCallRequestRow(callRequestId);
    if (!req) throw new NotFoundException('Call request not found');
    if (req.caller_id !== userId) {
      throw new ForbiddenException('You are not the recipient of this welcome call');
    }
    if (req.call_source !== 'welcome') {
      throw new BadRequestException('Not a welcome call request');
    }
    if (req.status !== 'requested') {
      throw new BadRequestException(`Call request is already ${req.status}`);
    }

    const startedAt = new Date().toISOString();
    const { data: callRow, error: callErr } = await this.supabase
      .getClient()
      .from('calls')
      .insert({
        caller_id: req.caller_id,
        creator_id: req.creator_id,
        type: req.type ?? 'voice',
        status: 'accepted',
        channel_name: req.channel_name,
        started_at: startedAt,
        call_source: 'welcome',
      })
      .select('id')
      .single();

    if (callErr) throw new BadRequestException(callErr.message);
    const callId = (callRow as { id: string }).id;

    await this.supabase
      .getClient()
      .from('call_requests')
      .update({ status: 'accepted', call_id: callId })
      .eq('id', callRequestId);

    const assignment = await this.findAssignmentByCallRequest(callRequestId);
    if (assignment) {
      await this.updateAssignment(assignment.id, { call_id: callId });
    }

    return {
      success: true,
      callRequestId,
      callSessionId: callId,
      channelName: req.channel_name as string,
    };
  }

  isWelcomeCallSource(source?: string | null): boolean {
    return source === 'welcome';
  }

  // ─── Private helpers ───────────────────────────────────────────

  private rowToCampaign(row: Record<string, unknown>): WelcomeCampaign {
    return {
      id: row.id as string,
      enabled: Boolean(row.enabled),
      rewardCoins: Number(row.reward_coins ?? 100),
      maxDurationSeconds: Number(row.max_duration_seconds ?? 300),
      assignmentStrategy: (row.assignment_strategy as WelcomeAssignmentStrategy) ?? 'online',
      createdAt: (row.created_at as string) ?? new Date().toISOString(),
      updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
    };
  }

  private rowToAssignment(row: Record<string, unknown>): WelcomeAssignment {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      campaignId: row.campaign_id as string,
      creatorProfileId: row.creator_profile_id as string,
      status: row.status as string,
      rewardCoins: Number(row.reward_coins ?? 100),
      callId: (row.call_id as string) || undefined,
      callRequestId: (row.call_request_id as string) || undefined,
      expiresAt: row.expires_at as string,
      acceptedAt: (row.accepted_at as string) || undefined,
      completedAt: (row.completed_at as string) || undefined,
      createdAt: (row.created_at as string) ?? new Date().toISOString(),
    };
  }

  private async getActiveCampaign(): Promise<WelcomeCampaign | null> {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase
        .getClient()
        .from('welcome_call_campaigns')
        .select('*')
        .eq('enabled', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return this.rowToCampaign(data as Record<string, unknown>);

      const { data: latest } = await this.supabase
        .getClient()
        .from('welcome_call_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) return this.rowToCampaign(latest as Record<string, unknown>);
      return null;
    }
    return this.memCampaigns[0] ?? null;
  }

  private async pickCreatorProfile(
    strategy: WelcomeAssignmentStrategy,
  ): Promise<string | null> {
    if (!this.supabase.isConfigured) return 'mem-profile-1';

    let query = this.supabase
      .getClient()
      .from('creator_profiles')
      .select('id, rating, total_calls, is_online, users!inner(id, is_creator, status)')
      .eq('users.is_creator', true)
      .eq('users.status', 'active');

    if (strategy === 'online') {
      query = query.eq('is_online', true);
    }

    const { data, error } = await query.limit(50);
    if (error || !data?.length) return null;

    let pool = data as Record<string, unknown>[];
    if (strategy === 'top_rated') {
      pool = [...pool].sort(
        (a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0),
      );
    } else if (strategy === 'legend') {
      pool = pool.filter((p) => Number(p.total_calls ?? 0) >= 100);
      pool.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
    } else if (strategy === 'random') {
      pool = [...pool].sort(() => Math.random() - 0.5);
    }

    return (pool[0]?.id as string) ?? null;
  }

  private async findAssignmentByUserId(userId: string): Promise<WelcomeAssignment | null> {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase
        .getClient()
        .from('welcome_call_assignments')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      return data ? this.rowToAssignment(data as Record<string, unknown>) : null;
    }
    return this.memAssignments.find((a) => a.userId === userId) ?? null;
  }

  private async findAssignmentById(id: string): Promise<WelcomeAssignment | null> {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase
        .getClient()
        .from('welcome_call_assignments')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      return data ? this.rowToAssignment(data as Record<string, unknown>) : null;
    }
    return this.memAssignments.find((a) => a.id === id) ?? null;
  }

  private async findPendingForCreator(
    creatorProfileId: string,
  ): Promise<WelcomeAssignment[]> {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase
        .getClient()
        .from('welcome_call_assignments')
        .select('*, users!welcome_call_assignments_user_id_fkey(full_name, name, avatar_url)')
        .eq('creator_profile_id', creatorProfileId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });
      return ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const a = this.rowToAssignment(row);
        const u = row.users as Record<string, unknown> | Record<string, unknown>[];
        const userRow = Array.isArray(u) ? u[0] : u;
        if (userRow) {
          a.userDisplayName =
            (userRow.full_name as string) || (userRow.name as string) || 'New user';
          a.userAvatarUrl = (userRow.avatar_url as string) || undefined;
        }
        return a;
      });
    }
    return this.memAssignments.filter(
      (a) => a.creatorProfileId === creatorProfileId && a.status === 'pending',
    );
  }

  private async createWelcomeCallRequest(params: {
    callerId: string;
    creatorUserId: string;
    channelName: string;
    assignmentId: string;
  }): Promise<string> {
    if (!this.supabase.isConfigured) return `req-${Date.now()}`;

    const { data, error } = await this.supabase
      .getClient()
      .from('call_requests')
      .insert({
        caller_id: params.callerId,
        creator_id: params.creatorUserId,
        type: 'voice',
        status: 'requested',
        channel_name: params.channelName,
        call_source: 'welcome',
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return (data as { id: string }).id;
  }

  private async updateAssignment(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    if (this.supabase.isConfigured) {
      await this.supabase
        .getClient()
        .from('welcome_call_assignments')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);
      return;
    }
    const mem = this.memAssignments.find((a) => a.id === id);
    if (mem) Object.assign(mem, patch);
  }

  private async markExpired(id: string): Promise<void> {
    await this.updateAssignment(id, { status: 'expired' });
  }

  private async expireStaleAssignments(): Promise<void> {
    if (!this.supabase.isConfigured) return;
    await this.supabase
      .getClient()
      .from('welcome_call_assignments')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString());
  }

  private async findCallRequestRow(id: string): Promise<Record<string, unknown> | null> {
    if (!this.supabase.isConfigured) return null;
    const { data } = await this.supabase
      .getClient()
      .from('call_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return (data as Record<string, unknown>) ?? null;
  }

  private async findAssignmentByCallRequest(
    callRequestId: string,
  ): Promise<WelcomeAssignment | null> {
    if (!this.supabase.isConfigured) return null;
    const { data } = await this.supabase
      .getClient()
      .from('welcome_call_assignments')
      .select('*')
      .eq('call_request_id', callRequestId)
      .maybeSingle();
    return data ? this.rowToAssignment(data as Record<string, unknown>) : null;
  }
}
