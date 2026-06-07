import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CreatorsService } from './creators.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Host Listeners Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('creators')
export class CreatorsController {
  constructor(private readonly creatorsService: CreatorsService) {}

  @Post()
  @ApiOperation({ summary: 'Apply to become a host listener' })
  @ApiResponse({ status: 201, description: 'Application submitted successfully.' })
  async apply(@Request() req: { user: { id: string } }, @Body() dto: any) {
    return this.creatorsService.apply(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all active host listeners' })
  @ApiResponse({ status: 200, description: 'List of active creators returned successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getActiveCreators() {
    const creators = await this.creatorsService.getActive();
    return creators.map(c => this.creatorsService.mapToDto(c));
  }

  @Get('pending')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get pending host applications (admin)' })
  @ApiResponse({ status: 200, description: 'List of pending host profiles.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getPending() {
    return this.creatorsService.getPending();
  }

  @Get('active')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get active host listeners (admin)' })
  @ApiResponse({ status: 200, description: 'List of active hosts.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getActive() {
    return this.creatorsService.getActive();
  }

  @Get('suspended')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get suspended host listeners (admin)' })
  @ApiResponse({ status: 200, description: 'List of suspended hosts.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getSuspended() {
    return this.creatorsService.getSuspended();
  }

  @Get('rejected')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get rejected host applications (admin)' })
  @ApiResponse({ status: 200, description: 'List of rejected host profiles.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getRejected() {
    return this.creatorsService.getRejected();
  }

  @Post('online')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator goes online (broadcasts via Supabase Realtime)' })
  @ApiResponse({ status: 200, description: 'is_online set to true.' })
  setOnline(@Request() req: { user: { id: string } }) {
    return this.creatorsService.setOnline(req.user.id);
  }

  @Post('offline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator goes offline (broadcasts via Supabase Realtime)' })
  @ApiResponse({ status: 200, description: 'is_online set to false.' })
  setOffline(@Request() req: { user: { id: string } }) {
    return this.creatorsService.setOffline(req.user.id);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator presence heartbeat (last_seen while online)' })
  @ApiResponse({ status: 200, description: 'last_seen_at updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'User is not a creator.' })
  heartbeat(@Request() req: { user: { id: string } }) {
    return this.creatorsService.recordHeartbeat(req.user.id);
  }

  @Get('earnings-history')
  @ApiOperation({ summary: 'Get current creator earnings history' })
  @ApiResponse({ status: 200, description: 'Earnings history list.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getEarningsHistory(@Request() req: { user: { id: string } }) {
    return this.creatorsService.getEarningsHistory(req.user.id);
  }

  @Get('wallet/balance')
  @ApiOperation({ summary: 'Get current creator wallet balance' })
  @ApiResponse({ status: 200, description: 'Wallet balance record.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getWalletBalance(@Request() req: { user: { id: string } }) {
    return this.creatorsService.getWalletBalance(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get host creator details by ID' })
  @ApiResponse({ status: 200, description: 'Creator details returned successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Creator not found.' })
  async getCreatorById(@Param('id') id: string) {
    const creator = await this.creatorsService.findOne(id);
    return this.creatorsService.mapToDto(creator);
  }

  @Post(':id/approve')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve host application (admin)' })
  @ApiResponse({ status: 200, description: 'Application approved.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  approve(@Param('id') id: string) {
    return this.creatorsService.approve(id);
  }

  @Post(':id/reject')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject host application (admin)' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  reject(@Param('id') id: string) {
    return this.creatorsService.reject(id);
  }

  @Post(':id/suspend')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle host suspension status (admin)' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  suspend(@Param('id') id: string) {
    return this.creatorsService.suspend(id);
  }
}
