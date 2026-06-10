import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CreatorDashboardController } from './creator-dashboard.controller';
import { CreatorDashboardService } from './creator-dashboard.service';
import { CreatorScopeGuard } from './creator-scope.guard';
import type { CreatorRequestScope } from './creator-dashboard.types';

describe('CreatorDashboardController', () => {
  let controller: CreatorDashboardController;

  const scope: CreatorRequestScope = {
    userId: 'user-1',
    creatorProfileId: 'profile-1',
    profileStatus: 'active',
    isSuspended: false,
    isWalletFrozen: false,
    displayName: 'Priya',
    avatarUrl: null,
    rating: 5,
    isOnline: false,
    accountCreatedAt: '2026-01-01T00:00:00.000Z',
  };

  const dashboardService = {
    getSummary: jest.fn().mockResolvedValue({ availableBalance: 100 }),
    getDashboard: jest.fn().mockResolvedValue({ schemaVersion: '3.1.0' }),
    getCallHistory: jest.fn().mockResolvedValue({ items: [], pageInfo: { hasMore: false } }),
    getGiftHistory: jest.fn().mockResolvedValue({ items: [], pageInfo: { hasMore: false } }),
    getWithdrawalHistory: jest.fn().mockResolvedValue({ items: [], pageInfo: { hasMore: false } }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreatorDashboardController],
      providers: [{ provide: CreatorDashboardService, useValue: dashboardService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CreatorScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CreatorDashboardController);
  });

  const req = { creatorScope: scope };

  it('GET summary delegates to service', async () => {
    const result = await controller.getSummary(req as never);
    expect(dashboardService.getSummary).toHaveBeenCalledWith(scope);
    expect(result.availableBalance).toBe(100);
  });

  it('GET dashboard delegates to service', async () => {
    await controller.getDashboard(req as never);
    expect(dashboardService.getDashboard).toHaveBeenCalledWith(scope);
  });

  it('GET history/calls delegates with query', async () => {
    await controller.getCallHistory(req as never, { limit: 20 });
    expect(dashboardService.getCallHistory).toHaveBeenCalledWith(scope, { limit: 20 });
  });
});
