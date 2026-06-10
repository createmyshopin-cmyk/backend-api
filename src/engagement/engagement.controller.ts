import {
  Body,
  Controller,
  Delete,
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
import { AppUserGuard } from '../auth/app-user.guard';
import {
  ClaimMissionDto,
  CreatorTargetDto,
  EngagementListQueryDto,
  RewardsQueryDto,
  UnfollowQueryDto,
} from './dto/engagement.dto';
import { EngagementService } from './engagement.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@ApiTags('Engagement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AppUserGuard)
@Controller('engagement')
export class EngagementController {
  private readonly logger = new Logger(EngagementController.name);

  constructor(private readonly engagementService: EngagementService) {}

  @Post('follow')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Follow a creator (self-scoped)' })
  async follow(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreatorTargetDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const start = performance.now();
    const result = await this.engagementService.follow(
      req.user.id,
      dto.creatorProfileId,
      idempotencyKey,
    );
    this.logger.log(`POST /engagement/follow ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Delete('follow')
  @ApiOperation({ summary: 'Unfollow a creator (self-scoped)' })
  async unfollow(
    @Request() req: AuthenticatedRequest,
    @Query() query: UnfollowQueryDto,
  ) {
    const start = performance.now();
    const result = await this.engagementService.unfollow(
      req.user.id,
      query.creatorProfileId,
    );
    this.logger.log(`DELETE /engagement/follow ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Post('favorite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Favorite a creator (self-scoped)' })
  async favorite(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreatorTargetDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const start = performance.now();
    const result = await this.engagementService.favorite(
      req.user.id,
      dto.creatorProfileId,
      idempotencyKey,
    );
    this.logger.log(`POST /engagement/favorite ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Delete('favorite')
  @ApiOperation({ summary: 'Remove creator from favorites (self-scoped)' })
  async unfavorite(
    @Request() req: AuthenticatedRequest,
    @Query() query: UnfollowQueryDto,
  ) {
    const start = performance.now();
    const result = await this.engagementService.unfavorite(
      req.user.id,
      query.creatorProfileId,
    );
    this.logger.log(`DELETE /engagement/favorite ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('follows')
  @ApiOperation({ summary: 'List creators the user follows' })
  async listFollows(
    @Request() req: AuthenticatedRequest,
    @Query() query: EngagementListQueryDto,
  ) {
    const start = performance.now();
    const result = await this.engagementService.listFollows(
      req.user.id,
      query.cursor,
      query.limit,
    );
    this.logger.log(`GET /engagement/follows ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('favorites')
  @ApiOperation({ summary: 'List user favorite creators' })
  async listFavorites(
    @Request() req: AuthenticatedRequest,
    @Query() query: EngagementListQueryDto,
  ) {
    const start = performance.now();
    const result = await this.engagementService.listFavorites(
      req.user.id,
      query.cursor,
      query.limit,
    );
    this.logger.log(`GET /engagement/favorites ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('levels')
  @ApiOperation({ summary: 'Get user XP/level (and creator level if applicable)' })
  async getLevels(@Request() req: AuthenticatedRequest) {
    const start = performance.now();
    const result = await this.engagementService.getLevels(req.user.id);
    this.logger.log(`GET /engagement/levels ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('missions')
  @ApiOperation({ summary: 'Get today daily missions board' })
  async getMissions(@Request() req: AuthenticatedRequest) {
    const start = performance.now();
    const result = await this.engagementService.getMissions(req.user.id);
    this.logger.log(`GET /engagement/missions ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Post('missions/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim completed mission or streak milestone reward' })
  async claimMission(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ClaimMissionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      idempotencyKey = `claim-${req.user.id}-${Date.now()}`;
    }
    const start = performance.now();
    const result = await this.engagementService.claimReward(
      req.user.id,
      dto,
      idempotencyKey,
    );
    this.logger.log(`POST /engagement/missions/claim ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('streak')
  @ApiOperation({ summary: 'Get streak snapshot and milestones' })
  async getStreak(@Request() req: AuthenticatedRequest) {
    const start = performance.now();
    const result = await this.engagementService.getStreak(req.user.id);
    this.logger.log(`GET /engagement/streak ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('rewards')
  @ApiOperation({ summary: 'Get engagement reward history' })
  async getRewards(
    @Request() req: AuthenticatedRequest,
    @Query() query: RewardsQueryDto,
  ) {
    const start = performance.now();
    const result = await this.engagementService.getRewards(req.user.id, query.limit);
    this.logger.log(`GET /engagement/rewards ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('premium-gifts')
  @ApiOperation({ summary: 'Get active premium gift catalog' })
  async getPremiumGifts() {
    const start = performance.now();
    const result = await this.engagementService.getPremiumGifts();
    this.logger.log(`GET /engagement/premium-gifts ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('combo-status')
  @ApiOperation({ summary: 'Get active combo progress (self-scoped)' })
  async getComboStatus(@Request() req: AuthenticatedRequest) {
    const start = performance.now();
    const result = await this.engagementService.getComboStatus(req.user.id);
    this.logger.log(`GET /engagement/combo-status ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('combo-history')
  @ApiOperation({ summary: 'Get combo send history (self-scoped)' })
  async getComboHistory(
    @Request() req: AuthenticatedRequest,
    @Query() query: RewardsQueryDto,
  ) {
    const start = performance.now();
    const result = await this.engagementService.getComboHistory(req.user.id, query.limit);
    this.logger.log(`GET /engagement/combo-history ${Math.round(performance.now() - start)}ms`);
    return result;
  }
}
