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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WithdrawalsService } from './withdrawals.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CreateWithdrawalDto, RejectWithdrawalDto, MarkPaidDto } from './dto/withdrawal.dto';

@ApiTags('Creator Withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get('my')
  @ApiOperation({ summary: 'Get withdrawals requested by the current creator' })
  @ApiResponse({ status: 200, description: 'List of creator withdrawals.' })
  getMyWithdrawals(@Request() req: { user: { id: string } }) {
    return this.withdrawalsService.getMyWithdrawals(req.user.id);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Get current creator available, earned, and withdrawn balances' })
  @ApiResponse({ status: 200, description: 'Creator wallet balances summary.' })
  getWalletBalance(@Request() req: { user: { id: string } }) {
    return this.withdrawalsService.getCreatorBalance(req.user.id);
  }

  @Post('request')
  @ApiOperation({ summary: 'Submit a new payout/withdrawal request' })
  @ApiResponse({ status: 201, description: 'Request created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation failed or insufficient balance.' })
  createRequest(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateWithdrawalDto,
  ) {
    const bankDetails = dto.paymentMethod === 'bank' ? {
      accountName: dto.bankAccountName,
      accountNumber: dto.bankAccountNumber,
      ifsc: dto.bankIfsc,
    } : undefined;

    return this.withdrawalsService.createWithdrawalRequest(
      req.user.id,
      dto.amount,
      dto.paymentMethod,
      bankDetails,
      dto.upiId,
    );
  }
}

@ApiTags('Admin Withdrawals Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all payout/withdrawal requests (admin)' })
  @ApiResponse({ status: 200, description: 'List of withdrawal requests.' })
  getRequests(@Query('status') status?: string) {
    return this.withdrawalsService.getAdminWithdrawals(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payout/withdrawal request details by ID (admin)' })
  @ApiResponse({ status: 200, description: 'Withdrawal details.' })
  @ApiResponse({ status: 404, description: 'Withdrawal request not found.' })
  getRequestById(@Param('id') id: string) {
    return this.withdrawalsService.getWithdrawalById(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve payout/withdrawal request' })
  @ApiResponse({ status: 200, description: 'Request approved successfully.' })
  approve(@Param('id') id: string) {
    return this.withdrawalsService.approveWithdrawal(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject payout/withdrawal request' })
  @ApiResponse({ status: 200, description: 'Request rejected successfully.' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.withdrawalsService.rejectWithdrawal(id, dto.reason);
  }

  @Post(':id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark payout/withdrawal request as paid and deduct balance' })
  @ApiResponse({ status: 200, description: 'Request status updated to paid, wallet updated.' })
  markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.withdrawalsService.markWithdrawalPaid(id, dto.referenceNumber, dto.notes);
  }
}
