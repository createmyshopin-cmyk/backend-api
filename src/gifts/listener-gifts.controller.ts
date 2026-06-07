import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CreatorGuard } from './creator.guard';
import { GiftService } from './gift.service';
import { UserThrottlerGuard } from './user-throttler.guard';

@ApiTags('Listener Gifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CreatorGuard, UserThrottlerGuard)
@Controller('listener/gifts')
export class ListenerGiftsController {
  constructor(private readonly giftService: GiftService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Creator gift stats (today / week / month / lifetime)' })
  @ApiResponse({ status: 200, description: 'Gift statistics for the authenticated creator.' })
  @ApiResponse({ status: 403, description: 'Creator access required.' })
  stats(@Request() req: { user: { id: string } }) {
    return this.giftService.getCreatorGiftStats(req.user.id);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Recent gifts received by creator' })
  @ApiResponse({ status: 200, description: 'Latest gifts received.' })
  @ApiResponse({ status: 403, description: 'Creator access required.' })
  recent(@Request() req: { user: { id: string } }) {
    return this.giftService.getCreatorRecentGifts(req.user.id);
  }
}
