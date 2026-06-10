import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/auth.guard';
import { GiftController } from './gift.controller';
import { GiftService } from './gift.service';
import { AppUserGuard } from './app-user.guard';
import { UserThrottlerGuard } from './user-throttler.guard';

describe('GiftController history', () => {
  let controller: GiftController;
  const giftService = {
    getSenderHistory: jest.fn().mockResolvedValue([]),
    listActiveGifts: jest.fn(),
    sendGift: jest.fn(),
    replyToGift: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GiftController],
      providers: [{ provide: GiftService, useValue: giftService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AppUserGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GiftController);
  });

  it('returns sender history for app users', async () => {
    const userId = '4f002dca-2813-4c26-8ed2-e02669d55e42';
    const result = await controller.history({ user: { id: userId } });
    expect(giftService.getSenderHistory).toHaveBeenCalledWith(userId);
    expect(result).toEqual([]);
  });
});

describe('AppUserGuard', () => {
  const guard = new AppUserGuard();

  it('rejects admin tokens', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { type: 'admin', id: 'ADM001' } }),
      }),
    } as never;

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows app users', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: '4f002dca-2813-4c26-8ed2-e02669d55e42' } }),
      }),
    } as never;

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
