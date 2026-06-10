import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import {
  MessagePaginationDto,
  SendMessageDto,
  UnlockMessageDto,
} from './dto/messages.dto';
import { MessagesService } from './messages.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(private readonly messagesService: MessagesService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List message conversations (self-scoped)' })
  async getConversations(
    @Request() req: AuthenticatedRequest,
    @Query() query: MessagePaginationDto,
  ) {
    const start = performance.now();
    const result = await this.messagesService.getConversations(
      req.user.id,
      query.limit,
    );
    this.logger.log(
      `GET /messages/conversations ${Math.round(performance.now() - start)}ms`,
    );
    return result;
  }

  @Get('history')
  @ApiOperation({ summary: 'Message spend history (self-scoped)' })
  async getHistory(
    @Request() req: AuthenticatedRequest,
    @Query() query: MessagePaginationDto,
  ) {
    const start = performance.now();
    const result = await this.messagesService.getHistory(req.user.id, query.limit);
    this.logger.log(`GET /messages/history ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get conversation session with messages (self-scoped)' })
  async getSession(
    @Request() req: AuthenticatedRequest,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() query: MessagePaginationDto,
  ) {
    const start = performance.now();
    const result = await this.messagesService.getSession(
      req.user.id,
      sessionId,
      query.limit ?? 50,
    );
    this.logger.log(`GET /messages/${sessionId} ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send text or voice note (self-scoped)' })
  async send(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SendMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        code: 'idempotency_key_required',
        message: 'Idempotency-Key header is required',
      });
    }
    const start = performance.now();
    const result = await this.messagesService.send(req.user.id, dto, idempotencyKey);
    this.logger.log(`POST /messages/send ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock 24h conversation session (self-scoped)' })
  async unlock(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UnlockMessageDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        code: 'idempotency_key_required',
        message: 'Idempotency-Key header is required',
      });
    }
    const start = performance.now();
    const result = await this.messagesService.unlock(req.user.id, dto, idempotencyKey);
    this.logger.log(`POST /messages/unlock ${Math.round(performance.now() - start)}ms`);
    return result;
  }
}
