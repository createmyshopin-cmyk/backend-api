import {
  Controller,
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
import { WelcomeCallsService } from './welcome-calls.service';

interface AuthRequest {
  user: { id: string };
}

@ApiTags('User Welcome Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls/welcome')
export class UserWelcomeCallsController {
  private readonly logger = new Logger(UserWelcomeCallsController.name);

  constructor(private readonly welcomeCalls: WelcomeCallsService) {}

  @Post(':callRequestId/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User accepts incoming welcome call from assigned guide' })
  async join(
    @Request() req: AuthRequest,
    @Param('callRequestId') callRequestId: string,
  ) {
    const start = performance.now();
    const result = await this.welcomeCalls.userJoinWelcomeCall(
      req.user.id,
      callRequestId,
    );
    this.logger.log(
      `POST /calls/welcome/${callRequestId}/join ${Math.round(performance.now() - start)}ms`,
    );
    return result;
  }
}
