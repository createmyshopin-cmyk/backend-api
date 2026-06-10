import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  Query,
  Headers,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WithdrawalsService } from './withdrawals.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AdminRequestUser } from '../auth/admin-user.types';
import {
  CreateWithdrawalDto,
  RejectWithdrawalDto,
  MarkPaidDto,
  FailWithdrawalDto,
  CancelWithdrawalDto,
} from './dto/withdrawal.dto';
import { AdminWithdrawalListQueryDto } from './dto/admin-withdrawal-query.dto';

@ApiTags('Creator Withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get('my')
  getMyWithdrawals(@Request() req: { user: { id: string } }) {
    return this.withdrawalsService.getMyWithdrawals(req.user.id);
  }

  @Get('balance')
  getWalletBalance(@Request() req: { user: { id: string } }) {
    return this.withdrawalsService.getCreatorBalance(req.user.id);
  }

  @Post('request')
  createRequest(
    @Request() req: { user: { id: string } },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateWithdrawalDto,
  ) {
    const bankDetails =
      dto.paymentMethod === 'bank'
        ? {
            accountName: dto.bankAccountName,
            accountNumber: dto.bankAccountNumber,
            ifsc: dto.bankIfsc,
          }
        : undefined;

    return this.withdrawalsService.createWithdrawalRequest(
      req.user.id,
      dto.amount,
      dto.paymentMethod,
      idempotencyKey,
      bankDetails,
      dto.upiId,
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending withdrawal request' })
  cancel(
    @Request() req: { user: { id: string } },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: CancelWithdrawalDto,
  ) {
    return this.withdrawalsService.cancelWithdrawal(
      id,
      req.user.id,
      idempotencyKey,
      dto.reason,
    );
  }
}

@ApiTags('Admin Withdrawals Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get('export')
  @Roles('super_admin', 'finance_admin')
  async exportCsv(@Query() query: AdminWithdrawalListQueryDto, @Res() res: Response) {
    const csv = await this.withdrawalsService.exportAdminWithdrawalsCsv(query);
    res.set('Content-Type', 'text/csv');
    res.attachment(`withdrawals-${query.status ?? 'all'}-${Date.now()}.csv`);
    return res.status(200).send(csv);
  }

  @Get()
  @Roles('super_admin', 'finance_admin', 'support_admin')
  getRequests(@Query() query: AdminWithdrawalListQueryDto) {
    return this.withdrawalsService.getAdminWithdrawalsPaginated(query);
  }

  @Get(':id')
  @Roles('super_admin', 'finance_admin', 'support_admin')
  getRequestById(@Param('id') id: string) {
    return this.withdrawalsService.getWithdrawalById(id);
  }

  @Post(':id/approve')
  @Roles('super_admin', 'finance_admin')
  @HttpCode(HttpStatus.OK)
  approve(
    @Request() req: { user: AdminRequestUser },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
  ) {
    return this.withdrawalsService.approveWithdrawal(id, req.user.id, idempotencyKey);
  }

  @Post(':id/reject')
  @Roles('super_admin', 'finance_admin')
  @HttpCode(HttpStatus.OK)
  reject(
    @Request() req: { user: AdminRequestUser },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.withdrawalsService.rejectWithdrawal(id, dto.reason, req.user.id, idempotencyKey);
  }

  @Post(':id/mark-paid')
  @Roles('super_admin', 'finance_admin')
  @HttpCode(HttpStatus.OK)
  markPaid(
    @Request() req: { user: AdminRequestUser },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.withdrawalsService.markWithdrawalPaid(
      id,
      dto.referenceNumber,
      req.user.id,
      idempotencyKey,
      dto.notes,
    );
  }

  @Post(':id/settle')
  @Roles('super_admin', 'finance_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Settle an approved withdrawal (alias for mark-paid)' })
  settle(
    @Request() req: { user: AdminRequestUser },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.withdrawalsService.markWithdrawalPaid(
      id,
      dto.referenceNumber,
      req.user.id,
      idempotencyKey,
      dto.notes,
    );
  }

  @Post(':id/fail')
  @Roles('super_admin', 'finance_admin')
  @HttpCode(HttpStatus.OK)
  fail(
    @Request() req: { user: AdminRequestUser },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: FailWithdrawalDto,
  ) {
    return this.withdrawalsService.failWithdrawal(id, dto.reason, req.user.id, idempotencyKey);
  }

  @Post(':id/cancel')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ops cancel approved withdrawal before gateway dispatch' })
  adminCancel(
    @Request() req: { user: AdminRequestUser },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: CancelWithdrawalDto,
  ) {
    return this.withdrawalsService.adminCancelWithdrawal(
      id,
      req.user.id,
      dto.reason ?? 'admin_cancelled',
      idempotencyKey,
    );
  }
}
