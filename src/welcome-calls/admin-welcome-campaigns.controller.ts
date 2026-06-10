import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { WelcomeCallsService } from './welcome-calls.service';
import { UpsertWelcomeCampaignDto } from './dto/welcome-campaign.dto';

@ApiTags('Admin Welcome Campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/welcome-campaigns')
export class AdminWelcomeCampaignsController {
  private readonly logger = new Logger(AdminWelcomeCampaignsController.name);

  constructor(private readonly welcomeCalls: WelcomeCallsService) {}

  @Get()
  @Roles('super_admin', 'operations_admin', 'support_admin')
  @ApiOperation({ summary: 'List welcome call campaigns' })
  list() {
    return this.welcomeCalls.listCampaigns();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin', 'operations_admin')
  @ApiOperation({ summary: 'Create or update welcome call campaign settings' })
  async upsert(@Body() dto: UpsertWelcomeCampaignDto) {
    const start = performance.now();
    const campaign = await this.welcomeCalls.upsertCampaign(dto);
    this.logger.log(
      `POST /admin/welcome-campaigns ${Math.round(performance.now() - start)}ms`,
    );
    return { success: true, campaign };
  }
}
