import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  InactiveCreatorsQueryDto,
  NewCreatorsQueryDto,
  PaginatedAnalyticsQueryDto,
  TimeWindowQueryDto,
} from './dto/analytics-query.dto';

const ANALYTICS_ROLES = ['super_admin', 'finance_admin', 'operations_admin', 'fraud_admin'] as const;

@ApiTags('Admin Creator Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/analytics/creators')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('overview')
  @Roles(...ANALYTICS_ROLES)
  overview(@Query() query: TimeWindowQueryDto) {
    return this.analytics.getCreatorsOverview(query.window ?? '7d');
  }

  @Get('top-earners')
  @Roles(...ANALYTICS_ROLES)
  topEarners(@Query() query: PaginatedAnalyticsQueryDto) {
    return this.analytics.getTopEarners(query.window ?? '7d', query.limit, query.cursor);
  }

  @Get('top-gifts')
  @Roles(...ANALYTICS_ROLES)
  topGifts(@Query() query: PaginatedAnalyticsQueryDto) {
    return this.analytics.getTopGifts(query.window ?? '7d', query.limit, query.cursor);
  }

  @Get('top-calls')
  @Roles(...ANALYTICS_ROLES)
  topCalls(@Query() query: PaginatedAnalyticsQueryDto) {
    return this.analytics.getTopCalls(query.window ?? '7d', query.limit, query.cursor);
  }

  @Get('top-messages')
  @Roles(...ANALYTICS_ROLES)
  topMessages(@Query() query: PaginatedAnalyticsQueryDto) {
    return this.analytics.getTopMessages(query.window ?? '7d', query.limit, query.cursor);
  }

  @Get('online')
  @Roles(...ANALYTICS_ROLES)
  online(@Query() query: PaginatedAnalyticsQueryDto) {
    return this.analytics.getOnlineCreators(query.limit, query.cursor);
  }

  @Get('new')
  @Roles(...ANALYTICS_ROLES)
  newCreators(@Query() query: NewCreatorsQueryDto) {
    return this.analytics.getNewCreators(query.window ?? '7d', query.limit, query.cursor);
  }

  @Get('inactive')
  @Roles(...ANALYTICS_ROLES)
  inactive(@Query() query: InactiveCreatorsQueryDto) {
    return this.analytics.getInactiveCreators(query.days ?? 30, query.limit, query.cursor);
  }
}
