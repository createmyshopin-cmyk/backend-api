import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreatorScopeGuard } from './creator-scope.guard';

describe('CreatorScopeGuard', () => {
  const maybeSingle = jest.fn();
  const eq = jest.fn();
  const select = jest.fn();
  const from = jest.fn();

  const supabase = {
    isConfigured: true,
    getClient: () => ({ from }),
  };

  const guard = new CreatorScopeGuard(supabase as never);

  beforeEach(() => {
    jest.clearAllMocks();
    from.mockImplementation((table: string) => {
      if (table === 'creator_profiles') {
        return { select: select.mockReturnValue({ eq: eq.mockReturnValue({ maybeSingle }) }) };
      }
      if (table === 'wallet_freeze_flags') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }),
              }),
            }),
          }),
        };
      }
      return { select: jest.fn() };
    });
  });

  function ctx(userId = 'user-1'): ExecutionContext {
    const request: { user: { id: string }; creatorScope?: unknown } = {
      user: { id: userId },
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  }

  it('rejects pending creators', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'profile-1',
        user_id: 'user-1',
        status: 'pending',
        rating: 5,
        users: { name: 'A', created_at: '2026-01-01' },
      },
      error: null,
    });

    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches scope for active creators', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'profile-1',
        user_id: 'user-1',
        status: 'active',
        rating: 4.5,
        is_online: true,
        users: { full_name: 'Priya', created_at: '2026-01-01' },
      },
      error: null,
    });

    const request: { user: { id: string }; creatorScope?: { creatorProfileId: string } } = {
      user: { id: 'user-1' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.creatorScope?.creatorProfileId).toBe('profile-1');
  });

  it('allows suspended creators for read-only APIs', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'profile-1',
        user_id: 'user-1',
        status: 'suspended',
        rating: 4,
        users: { name: 'X', created_at: '2026-01-01' },
      },
      error: null,
    });

    const request: { user: { id: string }; creatorScope?: { isSuspended: boolean } } = {
      user: { id: 'user-1' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;

    await guard.canActivate(context);
    expect(request.creatorScope?.isSuspended).toBe(true);
  });

  it('throws when profile missing', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(NotFoundException);
  });
});
