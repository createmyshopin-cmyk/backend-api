import { Injectable, Logger } from '@nestjs/common';
import { MissionRpcService } from './mission-rpc.service';

@Injectable()
export class MissionProgressHook {
  private readonly logger = new Logger(MissionProgressHook.name);

  constructor(private readonly missionRpc: MissionRpcService) {}

  async onGiftSent(userId: string, giftTransactionId: string): Promise<void> {
    await this.safeIncrement(userId, 'send_gift', giftTransactionId, `gift:${giftTransactionId}`);
  }

  async onCallCompleted(userId: string, callId: string): Promise<void> {
    await this.safeIncrement(userId, 'complete_call', callId, `call:${callId}`);
  }

  async onWalletRecharge(userId: string, paymentId: string): Promise<void> {
    await this.safeIncrement(userId, 'recharge_wallet', paymentId, `recharge:${paymentId}`);
  }

  private async safeIncrement(
    userId: string,
    missionKey: string,
    sourceId: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.missionRpc.incrementMissionProgress(
        userId,
        missionKey,
        sourceId,
        idempotencyKey,
      );
    } catch (e) {
      this.logger.warn(`mission hook ${missionKey} failed: ${(e as Error).message}`);
    }
  }
}
