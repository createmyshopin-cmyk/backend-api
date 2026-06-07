import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get()
  root() {
    return { status: 'ok', service: 'voice-calling-api' };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
