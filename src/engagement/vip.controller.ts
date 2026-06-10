import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RewardsQueryDto } from './dto/engagement.dto';
import { VipSubscribeDto } from './dto/vip.dto';
import { VipService } from './vip.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@ApiTags('Engagement VIP')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('engagement/vip')
export class VipController {
  private readonly logger = new Logger(VipController.name);

  constructor(private readonly vipService: VipService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Get active VIP plans catalog' })
  async getPlans() {
    const start = performance.now();
    const result = await this.vipService.getPlans();
    this.logger.log(`GET /engagement/vip/plans ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current user VIP status (self-scoped)' })
  async getStatus(@Request() req: AuthenticatedRequest) {
    const start = performance.now();
    const result = await this.vipService.getStatus(req.user.id);
    this.logger.log(`GET /engagement/vip/status ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('history')
  @ApiOperation({ summary: 'Get VIP membership history (self-scoped)' })
  async getHistory(
    @Request() req: AuthenticatedRequest,
    @Query() query: RewardsQueryDto,
  ) {
    const start = performance.now();
    const result = await this.vipService.getHistory(req.user.id, query.limit);
    this.logger.log(`GET /engagement/vip/history ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initiate or complete VIP subscription (Razorpay)' })
  async subscribe(
    @Request() req: AuthenticatedRequest,
    @Body() dto: VipSubscribeDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      idempotencyKey = `vip-sub-${req.user.id}-${Date.now()}`;
    }
    const start = performance.now();
    const result = await this.vipService.subscribe(
      req.user.id,
      dto,
      idempotencyKey,
    );
    this.logger.log(`POST /engagement/vip/subscribe ${Math.round(performance.now() - start)}ms`);
    return result;
  }
}
