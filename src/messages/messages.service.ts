import { BadRequestException, Injectable } from '@nestjs/common';
import { MessageRpcService } from './message-rpc.service';
import { SendMessageDto, UnlockMessageDto } from './dto/messages.dto';
import { UsersService } from '../users/users.service';
import { invalidCallRoleException } from '../calls/call-role.util';

@Injectable()
export class MessagesService {
  constructor(
    private readonly rpc: MessageRpcService,
    private readonly usersService: UsersService,
  ) {}

  private async assertUserMayInitiatePaidMessage(userId: string): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (user.isCreator) {
      throw invalidCallRoleException();
    }
  }

  async send(userId: string, dto: SendMessageDto, idempotencyKey: string) {
    await this.assertUserMayInitiatePaidMessage(userId);
    if (!dto.sessionId && !dto.creatorProfileId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        code: 'session_or_creator_required',
        message: 'Provide sessionId or creatorProfileId',
      });
    }

    let sessionId = dto.sessionId;
    if (!sessionId && dto.creatorProfileId) {
      sessionId = await this.rpc.ensureSession(userId, dto.creatorProfileId);
    }

    return this.rpc.sendMessage({
      actorUserId: userId,
      sessionId: sessionId!,
      messageType: dto.messageType,
      bodyText: dto.bodyText,
      voiceUrl: dto.voiceUrl,
      voiceDurationMs: dto.voiceDurationMs,
      idempotencyKey,
    });
  }

  async unlock(userId: string, dto: UnlockMessageDto, idempotencyKey: string) {
    await this.assertUserMayInitiatePaidMessage(userId);
    return this.rpc.unlockSession({
      userId,
      sessionId: dto.sessionId,
      unlockType: dto.unlockType,
      idempotencyKey,
    });
  }

  getConversations(userId: string, limit?: number) {
    return this.rpc.getConversations(userId, limit);
  }

  getSession(userId: string, sessionId: string, limit?: number) {
    return this.rpc.getSessionDetail(userId, sessionId, limit);
  }

  getHistory(userId: string, limit?: number) {
    return this.rpc.getHistory(userId, limit);
  }
}
