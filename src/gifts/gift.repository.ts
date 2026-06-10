import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateGiftDto, UpdateGiftDto } from './dto/gift.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
}

export interface GiftRow {
  id: string;
  name: string;
  iconUrl: string | null;
  coinCost: number;
  creatorSharePercent: number;
  platformSharePercent: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GiftTransactionRow {
  id: string;
  senderUserId: string;
  creatorId: string;
  giftId: string;
  callId: string;
  coinsSpent: number;
  creatorCoins: number;
  platformCoins: number;
  createdAt: string;
  giftName?: string;
  senderName?: string;
}

export interface SendGiftRpcResult {
  success: boolean;
  remaining_balance: number;
  gift_name: string;
  coins_spent: number;
  creator_coins: number;
  platform_coins: number;
  gift_transaction_id: string;
  sender_name?: string;
  sender_avatar?: string;
  creator_user_id?: string;
  duplicate?: boolean;
  combo?: Record<string, unknown>;
  gift?: Record<string, unknown>;
}

@Injectable()
export class GiftRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private mapGift(row: Record<string, unknown>): GiftRow {
    return {
      id: row.id as string,
      name: row.name as string,
      iconUrl: (row.icon_url as string) || null,
      coinCost: Number(row.coin_cost),
      creatorSharePercent: Number(row.creator_share_percent),
      platformSharePercent: Number(row.platform_share_percent),
      sortOrder: Number(row.sort_order),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private mapTransaction(row: Record<string, unknown>): GiftTransactionRow {
    const gifts = row.gifts as Record<string, unknown> | Record<string, unknown>[] | null;
    const gift = Array.isArray(gifts) ? gifts[0] : gifts;
    const users =
      (row.users as Record<string, unknown> | Record<string, unknown>[] | null) ??
      (row.sender as Record<string, unknown> | Record<string, unknown>[] | null);
    const user = Array.isArray(users) ? users[0] : users;

    return {
      id: row.id as string,
      senderUserId: row.sender_user_id as string,
      creatorId: row.creator_id as string,
      giftId: row.gift_id as string,
      callId: row.call_id as string,
      coinsSpent: Number(row.coins_spent),
      creatorCoins: Number(row.creator_coins),
      platformCoins: Number(row.platform_coins),
      createdAt: row.created_at as string,
      giftName: gift ? (gift.name as string) : undefined,
      senderName: user
        ? ((user.full_name as string) || (user.name as string))
        : undefined,
    };
  }

  async listActiveGifts(): Promise<GiftRow[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('gifts')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('coin_cost', { ascending: true });

    if (error) throw new Error(error.message);
    return (data as Record<string, unknown>[]).map((row) => this.mapGift(row));
  }

  async listAllGifts(): Promise<GiftRow[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('gifts')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('coin_cost', { ascending: true });

    if (error) throw new Error(error.message);
    return (data as Record<string, unknown>[]).map((row) => this.mapGift(row));
  }

  async findGiftById(id: string): Promise<GiftRow | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('gifts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? this.mapGift(data as Record<string, unknown>) : null;
  }

  async createGift(dto: CreateGiftDto): Promise<GiftRow> {
    const creatorShare = dto.creatorSharePercent ?? 60;
    const platformShare = dto.platformSharePercent ?? 40;
    if (creatorShare + platformShare !== 100) {
      throw new Error('creator_share_percent and platform_share_percent must sum to 100');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('gifts')
      .insert({
        name: dto.name,
        icon_url: dto.iconUrl ?? null,
        coin_cost: dto.coinCost,
        creator_share_percent: creatorShare,
        platform_share_percent: platformShare,
        sort_order: dto.sortOrder ?? 0,
        is_active: dto.isActive ?? true,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return this.mapGift(data as Record<string, unknown>);
  }

  async updateGift(id: string, dto: UpdateGiftDto): Promise<GiftRow> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.iconUrl !== undefined) patch.icon_url = dto.iconUrl;
    if (dto.coinCost !== undefined) patch.coin_cost = dto.coinCost;
    if (dto.sortOrder !== undefined) patch.sort_order = dto.sortOrder;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;

    if (dto.creatorSharePercent !== undefined || dto.platformSharePercent !== undefined) {
      const existing = await this.findGiftById(id);
      if (!existing) throw new Error('Gift not found');
      const creatorShare = dto.creatorSharePercent ?? existing.creatorSharePercent;
      const platformShare = dto.platformSharePercent ?? existing.platformSharePercent;
      if (creatorShare + platformShare !== 100) {
        throw new Error('creator_share_percent and platform_share_percent must sum to 100');
      }
      patch.creator_share_percent = creatorShare;
      patch.platform_share_percent = platformShare;
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('gifts')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return this.mapGift(data as Record<string, unknown>);
  }

  async softDeleteGift(id: string): Promise<GiftRow> {
    return this.updateGift(id, { isActive: false });
  }

  async sendGiftRpc(params: {
    senderUserId: string;
    creatorUserId: string;
    giftId: string;
    callId: string;
    idempotencyKey: string;
  }): Promise<SendGiftRpcResult> {
    const { data, error } = await this.supabase.getClient().rpc('send_gift', {
      p_sender_user_id: params.senderUserId,
      p_creator_user_id: params.creatorUserId,
      p_gift_id: params.giftId,
      p_call_id: params.callId,
      p_idempotency_key: params.idempotencyKey,
    });

    if (error) {
      throw new Error(error.message);
    }

    return data as SendGiftRpcResult;
  }

  async listSenderHistory(senderUserId: string, limit = 50): Promise<GiftTransactionRow[]> {
    assertUuid(senderUserId, 'sender user id');

    const { data, error } = await this.supabase
      .getClient()
      .from('gift_transactions')
      .select(
        '*, gifts(name), sender:users!gift_transactions_sender_user_id_fkey(name, full_name)',
      )
      .eq('sender_user_id', senderUserId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as Record<string, unknown>[]).map((row) => this.mapTransaction(row));
  }

  async listRecentForCreatorProfile(creatorProfileId: string, limit = 20): Promise<GiftTransactionRow[]> {
    assertUuid(creatorProfileId, 'creator profile id');

    const { data, error } = await this.supabase
      .getClient()
      .from('gift_transactions')
      .select(
        `*, gifts(name),
         sender:users!gift_transactions_sender_user_id_fkey(name, full_name, profile_image)`,
      )
      .eq('creator_id', creatorProfileId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as Record<string, unknown>[]).map((row) => this.mapTransaction(row));
  }

  async getCreatorGiftStats(creatorProfileId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('creator_gift_stats')
      .select('*')
      .eq('creator_id', creatorProfileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async getCreatorProfileByUserId(userId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('creator_profiles')
      .select('id, user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async insertGiftReply(params: {
    giftTransactionId: string;
    creatorProfileId: string;
    senderUserId: string;
    message: string;
  }) {
    const { data, error } = await this.supabase
      .getClient()
      .from('gift_replies')
      .insert({
        gift_transaction_id: params.giftTransactionId,
        creator_id: params.creatorProfileId,
        sender_user_id: params.senderUserId,
        message: params.message,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  /** Server-side audit only — not published to Supabase Realtime. */
  async insertAuditEvent(eventType: string, payload: Record<string, unknown>) {
    const { error } = await this.supabase
      .getClient()
      .from('gift_realtime_events')
      .insert({ event_type: eventType, payload });

    if (error) throw new Error(error.message);
  }

  async getUserFcmToken(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .select('fcm_token')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data?.fcm_token as string) || null;
  }

  async getGiftTransactionById(id: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('gift_transactions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async getAnalyticsSummary() {
    const { data, error } = await this.supabase
      .getClient()
      .rpc('gift_analytics_summary');

    if (error) throw new Error(error.message);
    return data;
  }
}
