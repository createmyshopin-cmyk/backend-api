import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FcmService } from '../fcm/fcm.service';
import { UsersService } from '../users/users.service';
import { SupabaseService } from '../supabase/supabase.service';
import { GiftRepository } from './gift.repository';
import { GiftService } from './gift.service';
import { MissionProgressHook } from '../engagement/mission-progress.hook';

const VALID_IDEM = '550e8400-e29b-41d4-a716-446655440000';

describe('GiftService', () => {
  let service: GiftService;
  let repository: jest.Mocked<GiftRepository>;
  let fcm: jest.Mocked<FcmService>;

  const mockSupabase = { isConfigured: true };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiftService,
        { provide: SupabaseService, useValue: mockSupabase },
        {
          provide: GiftRepository,
          useValue: {
            listActiveGifts: jest.fn(),
            sendGiftRpc: jest.fn(),
            listSenderHistory: jest.fn(),
            getCreatorProfileByUserId: jest.fn(),
            getCreatorGiftStats: jest.fn(),
            listRecentForCreatorProfile: jest.fn(),
            getGiftTransactionById: jest.fn(),
            insertGiftReply: jest.fn(),
            insertAuditEvent: jest.fn(),
            getAnalyticsSummary: jest.fn(),
            findGiftById: jest.fn(),
            getUserFcmToken: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: FcmService,
          useValue: {
            sendGiftReceived: jest.fn(),
            sendGiftReply: jest.fn(),
          },
        },
        {
          provide: MissionProgressHook,
          useValue: {
            onGiftSent: jest.fn(),
            onCallCompleted: jest.fn(),
            onWalletRecharge: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(GiftService);
    repository = module.get(GiftRepository);
    fcm = module.get(FcmService);
  });

  describe('fail closed', () => {
    it('rejects all financial ops when Supabase unavailable', async () => {
      (mockSupabase as { isConfigured: boolean }).isConfigured = false;

      await expect(service.sendGift('u1', {
        giftId: 'g1',
        creatorId: 'c1',
        callId: 'call1',
        idempotencyKey: VALID_IDEM,
      })).rejects.toBeInstanceOf(ServiceUnavailableException);

      (mockSupabase as { isConfigured: boolean }).isConfigured = true;
    });
  });

  describe('sendGift', () => {
    it('rejects self-gift at API layer', async () => {
      await expect(
        service.sendGift('same-user', {
          giftId: 'gift-uuid',
          creatorId: 'same-user',
          callId: 'call-uuid',
          idempotencyKey: VALID_IDEM,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps RPC success and sends FCM to creator', async () => {
      repository.sendGiftRpc.mockResolvedValue({
        success: true,
        remaining_balance: 4500,
        gift_name: 'Princess Crown',
        coins_spent: 500,
        creator_coins: 300,
        platform_coins: 200,
        gift_transaction_id: 'txn-1',
        sender_name: 'Alice',
        sender_avatar: 'https://x.test/a.png',
        duplicate: false,
      });
      repository.getUserFcmToken.mockResolvedValue('fcm-creator');

      const result = await service.sendGift('user-1', {
        giftId: 'gift-uuid',
        creatorId: 'creator-uuid',
        callId: 'call-uuid',
        idempotencyKey: VALID_IDEM,
      });

      expect(result.remainingBalance).toBe(4500);
      expect(result.creatorCoins).toBe(300);
      expect(fcm.sendGiftReceived).toHaveBeenCalled();
    });

    it('skips FCM on duplicate replay', async () => {
      repository.sendGiftRpc.mockResolvedValue({
        success: true,
        remaining_balance: 4500,
        gift_name: 'Rose',
        coins_spent: 10,
        creator_coins: 6,
        platform_coins: 4,
        gift_transaction_id: 'txn-dup',
        duplicate: true,
      });

      await service.sendGift('user-1', {
        giftId: 'gift-uuid',
        creatorId: 'creator-uuid',
        callId: 'call-uuid',
        idempotencyKey: VALID_IDEM,
      });

      expect(fcm.sendGiftReceived).not.toHaveBeenCalled();
    });

    it('maps insufficient_balance RPC error', async () => {
      repository.sendGiftRpc.mockRejectedValue(new Error('insufficient_balance'));
      await expect(
        service.sendGift('user-1', {
          giftId: 'g', creatorId: 'c', callId: 'call',
          idempotencyKey: VALID_IDEM,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps self_gift_not_allowed RPC error', async () => {
      repository.sendGiftRpc.mockRejectedValue(new Error('self_gift_not_allowed'));
      await expect(
        service.sendGift('user-1', {
          giftId: 'g', creatorId: 'c', callId: 'call',
          idempotencyKey: VALID_IDEM,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('maps creator_suspended RPC error', async () => {
      repository.sendGiftRpc.mockRejectedValue(new Error('creator_suspended'));
      await expect(
        service.sendGift('user-1', {
          giftId: 'g', creatorId: 'c', callId: 'call',
          idempotencyKey: VALID_IDEM,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
