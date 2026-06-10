import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminEngagementService } from './admin-engagement.service';
import { LeaderboardQueryDto } from './dto/analytics-query.dto';

const ENGAGEMENT_READ = ['super_admin', 'finance_admin', 'operations_admin', 'moderator'] as const;
const FINANCE_ENGAGEMENT = ['super_admin', 'finance_admin', 'operations_admin'] as const;

@ApiTags('Admin Engagement Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/engagement')
export class AdminEngagementController {
  constructor(private readonly engagement: AdminEngagementService) {}

  @Get('missions/overview')
  @Roles(...ENGAGEMENT_READ)
  missionsOverview() {
    return this.engagement.getMissionsOverview();
  }

  @Get('streaks/overview')
  @Roles(...ENGAGEMENT_READ)
  streaksOverview() {
    return this.engagement.getStreaksOverview();
  }

  @Get('follows/leaderboard')
  @Roles(...ENGAGEMENT_READ)
  followsLeaderboard(@Query() query: LeaderboardQueryDto) {
    return this.engagement.getFollowsLeaderboard(
      query.type ?? 'follows',
      query.limit,
      query.cursor,
    );
  }

  @Get('levels/distribution')
  @Roles(...ENGAGEMENT_READ)
  levelsDistribution() {
    return this.engagement.getLevelsDistribution();
  }

  @Get('vip/overview')
  @Roles(...FINANCE_ENGAGEMENT)
  vipOverview() {
    return this.engagement.getVipOverview();
  }

  @Get('messages/overview')
  @Roles(...FINANCE_ENGAGEMENT)
  messagesOverview() {
    return this.engagement.getMessagesOverview();
  }

  @Get('combos/overview')
  @Roles(...FINANCE_ENGAGEMENT)
  combosOverview() {
    return this.engagement.getCombosOverview();
  }
}
