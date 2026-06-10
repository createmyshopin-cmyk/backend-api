/**
 * Concurrency contract tests — verifies UserWalletService issues independent
 * RPC calls per operation (DB FOR UPDATE serializes wallet row).
 */
import { UserWalletService } from './user-wallet.service';

describe('UserWalletService concurrency contract', () => {
  it('issues parallel debits as separate RPC invocations', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: {
          coin_transaction_id: 'tx-1',
          user_id: 'u1',
          balance_before: 100,
          balance_after: 50,
          amount: -50,
          idempotent_replay: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'insufficient_balance', code: 'P0001' },
      });

    const service = new UserWalletService({
      isConfigured: true,
      getClient: () => ({ rpc }),
    } as never);

    const first = service.adjustUserCoinsV2({
      userId: 'u1',
      delta: -50,
      sourceType: 'call',
      sourceId: 'call-1',
      idempotencyKey: 'call-1-debit',
    });

    const second = service.adjustUserCoinsV2({
      userId: 'u1',
      delta: -60,
      sourceType: 'gift',
      sourceId: 'gift-1',
      idempotencyKey: 'gift-1-debit',
    });

    const [r1, r2] = await Promise.allSettled([first, second]);

    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('rejected');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_idempotency_key).not.toBe(
      rpc.mock.calls[1][1].p_idempotency_key,
    );
  });
});
