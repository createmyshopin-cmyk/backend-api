import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CallsService } from '../calls/calls.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AgoraTokenRequestDto } from './dto/agora-token-request.dto';

@ApiTags('Agora')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agora')
export class AgoraController {
  constructor(private readonly callsService: CallsService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate an Agora RTC token (backend only — never in Flutter)',
  })
  @ApiResponse({
    status: 200,
    description: 'Short-lived Agora token and channel name.',
    schema: {
      example: { token: '...', channelName: 'call_123' },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 500, description: 'Agora credentials not configured.' })
  generateToken(@Request() _req, @Body() dto: AgoraTokenRequestDto) {
    const channelName = dto.channelName?.trim() || `call_${Date.now()}`;
    const { token } = this.callsService.generateAgoraToken({ channelName });
    return { token, channelName };
  }
}
