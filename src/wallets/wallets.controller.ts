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
  Req,
  ForbiddenException,
  Headers,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { AdjustCoinsDto } from './dto/wallet.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AdminRequestUser } from '../auth/admin-user.types';

const WALLET_READ_ROLES = new Set([
  'super_admin',
  'finance_admin',
  'support_admin',
  'fraud_admin',
]);

function isAdminUser(user: { type?: string }): user is AdminRequestUser {
  return user.type === 'admin';
}

@ApiTags('Wallets & Balances')
@ApiBearerAuth()
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  getTransactions(
    @Request() req: { user: AdminRequestUser | { id: string; type?: string } },
    @Query('userId') userId?: string,
  ) {
    const targetId = userId ?? req.user.id;
    if (targetId !== req.user.id) {
      if (!isAdminUser(req.user) || !WALLET_READ_ROLES.has(req.user.role)) {
        throw new ForbiddenException('You can only view your own transactions');
      }
    }
    return this.walletsService.getTransactions(targetId);
  }

  @Get(':userId/balance')
  @UseGuards(JwtAuthGuard)
  getBalance(
    @Request() req: { user: AdminRequestUser | { id: string; type?: string } },
    @Param('userId') userId: string,
  ) {
    if (userId !== req.user.id) {
      if (!isAdminUser(req.user) || !WALLET_READ_ROLES.has(req.user.role)) {
        throw new ForbiddenException('You can only view your own balance');
      }
    }
    return this.walletsService.getBalance(userId);
  }

  @Post('adjust')
  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin', 'finance_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust user coin balance (finance_admin / super_admin)' })
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  adjust(
    @Request() req: { user: AdminRequestUser },
    @Req() expressReq: ExpressRequest,
    @Headers('x-idempotency-key') headerIdempotencyKey: string | undefined,
    @Body() adjustCoinsDto: AdjustCoinsDto,
  ) {
    return this.walletsService.adjustCoins(adjustCoinsDto, req.user, {
      ip: expressReq.ip,
      userAgent: expressReq.headers['user-agent'],
      idempotencyKey: adjustCoinsDto.idempotencyKey ?? headerIdempotencyKey,
    });
  }
}
