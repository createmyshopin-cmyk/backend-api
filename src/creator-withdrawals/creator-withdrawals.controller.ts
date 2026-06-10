import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import {
  CreatorScopeGuard,
  CreatorAuthenticatedRequest,
} from '../creator-dashboard/creator-scope.guard';
import { PayoutAccountService } from './payout-account.service';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { PutPayoutAccountDto } from './dto/payout-account.dto';
import { CancelWithdrawalDto, WithdrawalRequestDto } from './dto/withdrawal-request.dto';
import { WithdrawalHistoryQueryDto } from './dto/withdrawal-history-query.dto';
import { WithdrawalMutationGuard } from './guards/withdrawal-mutation.guard';

@ApiTags('Creator Withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CreatorScopeGuard)
@Controller('creator/withdrawals')
export class CreatorWithdrawalsController {
  private readonly logger = new Logger(CreatorWithdrawalsController.name);

  constructor(
    private readonly payoutAccountService: PayoutAccountService,
    private readonly withdrawalsService: CreatorWithdrawalsService,
  ) {}

  @Get('account')
  @ApiOperation({ summary: 'Get default payout account (masked)' })
  @ApiResponse({ status: 200, description: 'Payout account returned or empty.' })
  async getAccount(@Request() req: CreatorAuthenticatedRequest) {
    const start = performance.now();
    const result = await this.payoutAccountService.getAccount(req.creatorScope);
    this.logger.log(`GET /creator/withdrawals/account ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Put('account')
  @UseGuards(WithdrawalMutationGuard)
  @ApiOperation({ summary: 'Create or update default payout account' })
  async putAccount(
    @Request() req: CreatorAuthenticatedRequest,
    @Body() dto: PutPayoutAccountDto,
  ) {
    const start = performance.now();
    const result = await this.payoutAccountService.putAccount(req.creatorScope, dto);
    this.logger.log(`PUT /creator/withdrawals/account ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Post('request')
  @UseGuards(WithdrawalMutationGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a withdrawal' })
  async requestWithdrawal(
    @Request() req: CreatorAuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: WithdrawalRequestDto,
  ) {
    const start = performance.now();
    const result = await this.withdrawalsService.requestWithdrawal(
      req.creatorScope,
      dto,
      idempotencyKey,
    );
    this.logger.log(`POST /creator/withdrawals/request ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Post(':id/cancel')
  @UseGuards(WithdrawalMutationGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending withdrawal' })
  async cancelWithdrawal(
    @Request() req: CreatorAuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CancelWithdrawalDto,
  ) {
    return this.withdrawalsService.cancelWithdrawal(
      req.creatorScope,
      id,
      idempotencyKey,
      dto.reason,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Paginated withdrawal history' })
  async getHistory(
    @Request() req: CreatorAuthenticatedRequest,
    @Query() query: WithdrawalHistoryQueryDto,
  ) {
    const start = performance.now();
    const result = await this.withdrawalsService.getHistory(req.creatorScope, query);
    this.logger.log(`GET /creator/withdrawals/history ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('status')
  @ApiOperation({ summary: 'Inflight withdrawal and eligibility snapshot' })
  async getStatus(@Request() req: CreatorAuthenticatedRequest) {
    const start = performance.now();
    const result = await this.withdrawalsService.getStatus(req.creatorScope);
    this.logger.log(`GET /creator/withdrawals/status ${Math.round(performance.now() - start)}ms`);
    return result;
  }
}
