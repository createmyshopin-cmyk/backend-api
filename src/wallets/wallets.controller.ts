import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { AdjustCoinsDto } from './dto/wallet.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Wallets & Balances')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Get wallet transactions (own history, or admin with userId filter)' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiResponse({ status: 200, description: 'List of transactions returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getTransactions(
    @Request() req: { user: { id: string; role?: string } },
    @Query('userId') userId?: string,
  ) {
    const isAdmin =
      req.user.role === 'super_admin' ||
      req.user.role === 'finance_admin' ||
      req.user.role === 'moderator' ||
      req.user.role === 'admin';
    if (userId && userId !== req.user.id && !isAdmin) {
      throw new ForbiddenException('You can only view your own transactions');
    }
    const scopedUserId = isAdmin && userId ? userId : req.user.id;
    return this.walletsService.getTransactions(scopedUserId);
  }

  @Get(':userId/balance')
  @ApiOperation({ summary: 'Get user coin balance (self or admin)' })
  @ApiResponse({ status: 200, description: 'Balance returned.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  getBalance(
    @Request() req: { user: { id: string; role?: string } },
    @Param('userId') userId: string,
  ) {
    if (!req.user.role && req.user.id !== userId) {
      throw new ForbiddenException('You can only view your own balance');
    }
    return this.walletsService.getBalance(userId);
  }

  @Post('adjust')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust user coin balance (admin only)' })
  @ApiResponse({ status: 200, description: 'Coins adjusted and transaction logged.' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or bad parameters.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  adjust(@Body() adjustCoinsDto: AdjustCoinsDto) {
    return this.walletsService.adjustCoins(adjustCoinsDto);
  }
}
