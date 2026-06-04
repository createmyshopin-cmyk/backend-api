import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { EndCallDto } from './dto/call.dto';
import { RequestCallDto } from './dto/call-request.dto';
import { CallRequestActionDto } from './dto/call-action.dto';
import { AgoraTokenDto } from './dto/agora-token.dto';
import { UpdateCallStatusDto } from './dto/update-call-status.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Call Connections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  // ── Monitoring (admin) ──────────────────────────────────────────────────────

  @Get('active')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get live active call sessions (admin)' })
  @ApiResponse({ status: 200, description: 'List of active sessions.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getActive() {
    return this.callsService.getActive();
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get all historical call sessions (admin)' })
  @ApiResponse({ status: 200, description: 'List of historical call sessions.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getAdminHistory() {
    return this.callsService.getHistory();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get call history for the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of completed/missed calls for caller or creator.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getHistory(@Request() req) {
    return this.callsService.getHistoryForUser(req.user.id);
  }

  // ── App endpoints (JWT required) ────────────────────────────────────────────

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer initiates a call to a creator (pending)' })
  @ApiResponse({
    status: 200,
    description: 'Call request created. Creator must accept or reject.',
  })
  @ApiResponse({ status: 400, description: 'Insufficient coins or invalid creator.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Creator not found.' })
  requestCall(@Request() req, @Body() dto: RequestCallDto) {
    return this.callsService.requestCall(req.user.id, dto);
  }

  @Get('requests/pending')
  @ApiOperation({ summary: 'List pending incoming call requests (creator)' })
  @ApiResponse({ status: 200, description: 'Pending call requests.' })
  getPendingRequests(@Request() req) {
    return this.callsService.getPendingRequestsForCreator(req.user.id);
  }

  @Get('requests/:id/status')
  @ApiOperation({ summary: 'Poll call request status (caller or creator)' })
  @ApiResponse({ status: 200, description: 'Current call request status.' })
  getCallRequestStatus(@Request() req, @Param('id') id: string) {
    return this.callsService.getCallRequestStatus(req.user.id, id);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator accepts an incoming call request' })
  @ApiResponse({
    status: 200,
    description: 'Call accepted. Returns active session and Agora details.',
  })
  acceptCall(@Request() req, @Body() dto: CallRequestActionDto) {
    return this.callsService.acceptCall(req.user.id, dto);
  }

  @Post('reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator rejects an incoming call request' })
  @ApiResponse({ status: 200, description: 'Call request rejected.' })
  rejectCall(@Request() req, @Body() dto: CallRequestActionDto) {
    return this.callsService.rejectCall(req.user.id, dto);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator accepts a call request by ID' })
  @ApiResponse({
    status: 200,
    description: 'Call status set to accepted. Returns active session and Agora details.',
  })
  @ApiResponse({ status: 403, description: 'Only the creator can accept this call.' })
  @ApiResponse({ status: 404, description: 'Call request not found.' })
  acceptCallById(@Request() req, @Param('id') id: string) {
    return this.callsService.acceptCall(req.user.id, { callId: id });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator rejects a call request by ID' })
  @ApiResponse({ status: 200, description: 'Call status set to rejected.' })
  @ApiResponse({ status: 403, description: 'Only the creator can reject this call.' })
  @ApiResponse({ status: 404, description: 'Call request not found.' })
  rejectCallById(@Request() req, @Param('id') id: string) {
    return this.callsService.rejectCall(req.user.id, { callId: id });
  }

  @Patch('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a pending call request (creator, legacy path)' })
  @ApiResponse({ status: 200, description: 'Call request accepted; active session created.' })
  acceptCallRequest(@Request() req, @Param('id') id: string) {
    return this.callsService.acceptCallRequest(id, req.user.id);
  }

  @Patch('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending call request (legacy path)' })
  @ApiResponse({ status: 200, description: 'Call request rejected.' })
  rejectCallRequest(@Request() req, @Param('id') id: string) {
    return this.callsService.rejectCallRequest(id, req.user.id);
  }

  @Post('requests/:id/missed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a call request as missed (ring timeout)' })
  @ApiResponse({ status: 200, description: 'Call request marked as expired.' })
  markCallRequestMissed(@Request() req, @Param('id') id: string) {
    return this.callsService.markCallRequestMissed(id, req.user.id);
  }

  @Post('agora-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a backend-owned Agora RTC token for a channel',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns a short-lived Agora token, appId, channelName, uid, and expiresAt (Unix seconds).',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 500, description: 'Agora credentials not configured.' })
  generateAgoraToken(@Body() dto: AgoraTokenDto) {
    return this.callsService.generateAgoraToken(dto);
  }

  @Patch('active/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Advance call lifecycle (ringing → ongoing)' })
  @ApiResponse({ status: 200, description: 'Call status updated.' })
  updateCallStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateCallStatusDto,
  ) {
    return this.callsService.updateCallStatus(req.user.id, id, dto);
  }

  @Post('active/:id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'End a call session — backend computes and deducts coins',
  })
  @ApiResponse({
    status: 200,
    description: 'Call ended. Returns coinsDeducted and newBalance.',
  })
  @ApiResponse({ status: 400, description: 'Call already ended.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Call session not found.' })
  endCall(@Param('id') id: string, @Body() dto: EndCallDto) {
    return this.callsService.endCall(id, dto);
  }
}
