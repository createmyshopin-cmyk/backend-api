import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FcmService } from '../fcm/fcm.service';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersService, resolveDisplayName } from '../users/users.service';
import {
  CreateGiftDto,
  GiftReplyDto,
  SendGiftDto,
  UpdateGiftDto,
} from './dto/gift.dto';
import { GiftRepository } from './gift.repository';
import { MissionProgressHook } from '../engagement/mission-progress.hook';

const RPC_ERROR_MAP: Record<string, string> = {
  sender_not_found: 'Sender not found',
  sender_not_active: 'Sender account is not active',
  gift_not_found: 'Gift not found',
  gift_disabled: 'This gift is currently unavailable',
  call_not_found: 'Call not found',
  call_not_active: 'Gifts can only be sent during an active call',
  call_creator_mismatch: 'Call does not belong to this creator',
  call_sender_mismatch: 'You are not a participant in this call',
  creator_not_found: 'Creator not found',
  creator_not_approved: 'Creator is not approved',
  creator_suspended: 'Creator is suspended',
  creator_profile_not_found: 'Creator profile not found',
  creator_offline: 'Creator is offline',
  insufficient_balance: 'Insufficient coin balance',
  idempotency_key_required: 'idempotencyKey is required',
  idempotency_key_invalid: 'idempotencyKey must be a valid UUID',
  self_gift_not_allowed: 'Cannot send gifts to yourself',
};

@Injectable()
export class GiftService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly repository: GiftRepository,
    private readonly usersService: UsersService,
    private readonly fcmService: FcmService,
    private readonly missionHook: MissionProgressHook,
  ) {}

  private requireSupabase(): void {
    if (!this.supabase.isConfigured) {
      throw new ServiceUnavailableException(
        'Gift service is unavailable. Database connection required.',
      );
    }
  }

  private mapRpcError(message: string): never {
    const code = message.match(/^([a-z_]+)/)?.[1] ?? message;
    const friendly = RPC_ERROR_MAP[code] ?? message;
    if (code === 'insufficient_balance' || code === 'idempotency_key_invalid') {
      throw new BadRequestException(friendly);
    }
    if (
      code === 'gift_not_found' ||
      code === 'call_not_found' ||
      code === 'creator_not_found' ||
      code === 'creator_profile_not_found'
    ) {
      throw new NotFoundException(friendly);
    }
    if (
      code === 'creator_suspended' ||
      code === 'creator_not_approved' ||
      code === 'call_sender_mismatch' ||
      code === 'self_gift_not_allowed'
    ) {
      throw new ForbiddenException(friendly);
    }
    throw new BadRequestException(friendly);
  }

  async listActiveGifts() {
    this.requireSupabase();
    return this.repository.listActiveGifts();
  }

  async listAllGiftsAdmin() {
    this.requireSupabase();
    return this.repository.listAllGifts();
  }

  async createGiftAdmin(dto: CreateGiftDto) {
    this.requireSupabase();
    return this.repository.createGift(dto);
  }

  async updateGiftAdmin(id: string, dto: UpdateGiftDto) {
    this.requireSupabase();
    const existing = await this.repository.findGiftById(id);
    if (!existing) throw new NotFoundException('Gift not found');
    return this.repository.updateGift(id, dto);
  }

  async deleteGiftAdmin(id: string) {
    this.requireSupabase();
    const existing = await this.repository.findGiftById(id);
    if (!existing) throw new NotFoundException('Gift not found');
    return this.repository.softDeleteGift(id);
  }

  async sendGift(senderUserId: string, dto: SendGiftDto) {
    this.requireSupabase();

    if (senderUserId === dto.creatorId) {
      throw new BadRequestException('Cannot send gifts to yourself');
    }

    try {
      const result = await this.repository.sendGiftRpc({
        senderUserId,
        creatorUserId: dto.creatorId,
        giftId: dto.giftId,
        callId: dto.callId,
        idempotencyKey: dto.idempotencyKey,
      });

      if (!result.duplicate) {
        await this.missionHook.onGiftSent(
          senderUserId,
          String(result.gift_transaction_id),
        );
        const creatorFcm = await this.repository.getUserFcmToken(dto.creatorId);
        if (creatorFcm) {
          const combo = result.combo as Record<string, unknown> | undefined;
          const giftMeta = result.gift as Record<string, unknown> | undefined;
          await this.fcmService.sendGiftReceived({
            fcmToken: creatorFcm,
            giftTransactionId: result.gift_transaction_id,
            senderId: senderUserId,
            senderName: result.sender_name ?? 'User',
            senderAvatar: result.sender_avatar ?? '',
            giftName: result.gift_name,
            giftCoins: Number(result.coins_spent),
            creatorCoins: Number(result.creator_coins),
            comboCount: combo ? Number(combo.combo_index ?? combo.comboIndex ?? 1) : 1,
            isPremium: Boolean(giftMeta?.isPremium ?? giftMeta?.is_premium),
          });
        }
      }

      const comboRaw = result.combo as Record<string, unknown> | undefined;
      const giftRaw = result.gift as Record<string, unknown> | undefined;

      return {
        success: Boolean(result.success),
        remainingBalance: Number(result.remaining_balance),
        giftName: result.gift_name,
        coinsSpent: Number(result.coins_spent),
        creatorCoins: Number(result.creator_coins),
        platformCoins: Number(result.platform_coins),
        giftTransactionId: result.gift_transaction_id,
        duplicate: Boolean(result.duplicate),
        combo: comboRaw
          ? {
              comboGroupId: String(comboRaw.combo_group_id ?? comboRaw.comboGroupId ?? ''),
              comboIndex: Number(comboRaw.combo_index ?? comboRaw.comboIndex ?? 1),
              isContinuation: Boolean(
                comboRaw.is_continuation ?? comboRaw.isContinuation,
              ),
              comboWindowMs: Number(
                comboRaw.combo_window_ms ?? comboRaw.comboWindowMs ?? 10000,
              ),
            }
          : undefined,
        gift: giftRaw
          ? {
              isPremium: Boolean(giftRaw.isPremium ?? giftRaw.is_premium),
              campaignKey: giftRaw.campaignKey ?? giftRaw.campaign_key,
              premiumGiftId: giftRaw.premiumGiftId ?? giftRaw.premium_gift_id,
              displayTier: giftRaw.displayTier ?? giftRaw.display_tier,
              badgeLabel: giftRaw.badgeLabel ?? giftRaw.badge_label,
            }
          : undefined,
      };
    } catch (e) {
      this.mapRpcError((e as Error).message);
    }
  }

  async getSenderHistory(senderUserId: string) {
    this.requireSupabase();
    try {
      return await this.repository.listSenderHistory(senderUserId);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new ServiceUnavailableException(
        'Unable to load gift history',
      );
    }
  }

  async getCreatorGiftStats(creatorUserId: string) {
    this.requireSupabase();
    const profile = await this.repository.getCreatorProfileByUserId(creatorUserId);
    if (!profile) throw new NotFoundException('Creator profile not found');

    const stats = await this.repository.getCreatorGiftStats(profile.id);
    return {
      today: stats?.today_gifts ?? 0,
      week: stats?.week_gifts ?? 0,
      month: stats?.month_gifts ?? 0,
      lifetime: stats?.total_gifts ?? 0,
      totalGiftCoins: stats?.total_gift_coins ?? 0,
      totalGiftEarnings: stats?.total_gift_earnings ?? 0,
      lastGiftAt: stats?.last_gift_at ?? null,
    };
  }

  async getCreatorRecentGifts(creatorUserId: string) {
    this.requireSupabase();
    const profile = await this.repository.getCreatorProfileByUserId(creatorUserId);
    if (!profile) throw new NotFoundException('Creator profile not found');
    return this.repository.listRecentForCreatorProfile(profile.id);
  }

  async replyToGift(creatorUserId: string, dto: GiftReplyDto) {
    this.requireSupabase();

    const profile = await this.repository.getCreatorProfileByUserId(creatorUserId);
    if (!profile) throw new NotFoundException('Creator profile not found');

    const txn = await this.repository.getGiftTransactionById(dto.giftTransactionId);
    if (!txn) throw new NotFoundException('Gift transaction not found');
    if (txn.creator_id !== profile.id) {
      throw new ForbiddenException('You can only reply to gifts sent to you');
    }

    const creatorUser = await this.usersService.findOne(creatorUserId);
    const creatorName = resolveDisplayName(
      { full_name: creatorUser.fullName, name: creatorUser.name },
      'Creator',
    );

    await this.repository.insertGiftReply({
      giftTransactionId: dto.giftTransactionId,
      creatorProfileId: profile.id,
      senderUserId: txn.sender_user_id as string,
      message: dto.message,
    });

    const createdAt = new Date().toISOString();

    await this.repository.insertAuditEvent('gift_reply', {
      giftTransactionId: dto.giftTransactionId,
      message: dto.message,
      creatorName,
      creatorUserId,
      senderUserId: txn.sender_user_id,
      createdAt,
    });

    const senderFcm = await this.repository.getUserFcmToken(txn.sender_user_id as string);
    if (senderFcm) {
      await this.fcmService.sendGiftReply({
        fcmToken: senderFcm,
        giftTransactionId: dto.giftTransactionId,
        creatorName,
        message: dto.message,
      });
    }

    return { success: true, message: dto.message, createdAt };
  }

  async getAdminAnalytics() {
    this.requireSupabase();
    return this.repository.getAnalyticsSummary();
  }
}
