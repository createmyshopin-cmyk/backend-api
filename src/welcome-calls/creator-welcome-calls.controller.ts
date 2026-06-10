import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import {
  CreatorAuthenticatedRequest,
  CreatorScopeGuard,
} from '../creator-dashboard/creator-scope.guard';
import { WelcomeCallsService } from './welcome-calls.service';

@ApiTags('Creator Welcome Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CreatorScopeGuard)
@Controller('creator/welcome-calls')
export class CreatorWelcomeCallsController {
  private readonly logger = new Logger(CreatorWelcomeCallsController.name);

  constructor(private readonly welcomeCalls: WelcomeCallsService) {}

  @Get()
  @ApiOperation({ summary: 'Pending welcome call opportunities for this creator' })
  list(@Request() req: CreatorAuthenticatedRequest) {
    return this.welcomeCalls.listPendingForCreator(req.creatorScope.creatorProfileId);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a welcome call opportunity' })
  async accept(
    @Request() req: CreatorAuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const start = performance.now();
    const result = await this.welcomeCalls.acceptAssignment(
      id,
      req.creatorScope.creatorProfileId,
      req.user.id,
    );
    this.logger.log(
      `POST /creator/welcome-calls/${id}/accept ${Math.round(performance.now() - start)}ms`,
    );
    return result;
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a welcome call opportunity' })
  async reject(
    @Request() req: CreatorAuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const start = performance.now();
    const result = await this.welcomeCalls.rejectAssignment(
      id,
      req.creatorScope.creatorProfileId,
    );
    this.logger.log(
      `POST /creator/welcome-calls/${id}/reject ${Math.round(performance.now() - start)}ms`,
    );
    return result;
  }
}
