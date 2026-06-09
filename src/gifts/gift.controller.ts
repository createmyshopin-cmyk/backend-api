import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CreatorGuard } from './creator.guard';
import { GiftReplyDto, SendGiftDto } from './dto/gift.dto';
import { GiftService } from './gift.service';
import { UserThrottlerGuard } from './user-throttler.guard';

/** In-call gifting: high enough for combos, low enough to block abuse. */
export const GIFT_SEND_RATE_LIMIT = { limit: 30, ttl: 60_000 } as const;

@ApiTags('Gifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@Controller('gifts')
export class GiftController {
  constructor(private readonly giftService: GiftService) {}

  @Get()
  @ApiOperation({ summary: 'List active gifts (catalog)' })
  @ApiResponse({ status: 200, description: 'Active gift catalog.' })
  listActive() {
    return this.giftService.listActiveGifts();
  }

  @Post('send')
  @Throttle({ default: GIFT_SEND_RATE_LIMIT })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a gift during an active call' })
  @ApiResponse({ status: 200, description: 'Gift sent successfully.' })
  @ApiResponse({ status: 400, description: 'Validation or insufficient balance.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded.' })
  sendGift(@Request() req: { user: { id: string } }, @Body() dto: SendGiftDto) {
    return this.giftService.sendGift(req.user.id, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Sender gift history' })
  @ApiResponse({ status: 200, description: 'Gift send history for authenticated user.' })
  history(@Request() req: { user: { id: string } }) {
    return this.giftService.getSenderHistory(req.user.id);
  }

  @Post('reply')
  @UseGuards(CreatorGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator replies to a received gift' })
  @ApiResponse({ status: 200, description: 'Reply delivered via FCM.' })
  @ApiResponse({ status: 403, description: 'Creator access required.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded.' })
  reply(@Request() req: { user: { id: string } }, @Body() dto: GiftReplyDto) {
    return this.giftService.replyToGift(req.user.id, dto);
  }
}
