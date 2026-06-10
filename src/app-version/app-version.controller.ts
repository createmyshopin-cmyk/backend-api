import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AppVersionService } from './app-version.service';
import { ReportAppVersionDto } from './dto/app-version.dto';
import { SkipAppVersion } from './skip-app-version.decorator';

@ApiTags('App Version')
@Controller('app')
export class AppVersionController {
  constructor(private readonly appVersion: AppVersionService) {}

  @Public()
  @Get('version')
  @ApiOperation({ summary: 'Public app version and maintenance config' })
  @ApiQuery({ name: 'platform', required: false, enum: ['android', 'ios'] })
  getVersion(@Query('platform') platform?: 'android' | 'ios') {
    return this.appVersion.getPublicConfig(platform);
  }

  @Post('version/report')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @SkipAppVersion()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report installed app version for analytics' })
  report(
    @Request() req: { user: { id: string } },
    @Body() dto: ReportAppVersionDto,
  ) {
    return this.appVersion.reportUserVersion(
      req.user.id,
      dto.version,
      dto.buildNumber,
      dto.platform,
    );
  }
}
