import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { RazorpayService } from './razorpay.service';
import { CreatePackageDto, UpdatePackageDto } from './dto/coin-package.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { AdminGuard } from '../../auth/admin.guard';

@ApiTags('Recharges & Coin Packages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly razorpayService: RazorpayService,
  ) {}

  @Get('gateway-status')
  @ApiOperation({ summary: 'Razorpay vs mock checkout mode (no secrets exposed)' })
  getGatewayStatus() {
    return this.razorpayService.getGatewayStatus();
  }

  // ── Coin packages (public) ──────────────────────────────────────────────────

  @Get('packages')
  @ApiOperation({ summary: 'List active coin packages' })
  @ApiResponse({ status: 200, description: 'Ordered list of active coin packages.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getPackages() {
    return this.paymentsService.getPackages();
  }

  @Get('packages/:id')
  @ApiOperation({ summary: 'Get a single coin package by ID' })
  @ApiParam({ name: 'id', description: 'Coin package UUID' })
  @ApiResponse({ status: 200, description: 'Coin package found.' })
  @ApiResponse({ status: 404, description: 'Package not found.' })
  getPackage(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getPackageById(id);
  }

  // ── Coin packages (admin) ───────────────────────────────────────────────────

  @Post('packages')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Admin] Create a new coin package' })
  @ApiResponse({ status: 201, description: 'Package created.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  createPackage(@Body() dto: CreatePackageDto) {
    return this.paymentsService.createPackage(dto);
  }

  @Patch('packages/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Update a coin package (partial update)' })
  @ApiParam({ name: 'id', description: 'Coin package UUID' })
  @ApiResponse({ status: 200, description: 'Package updated.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Package not found.' })
  updatePackage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackageDto,
  ) {
    return this.paymentsService.updatePackage(id, dto);
  }

  @Delete('packages/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Deactivate a coin package (soft-delete)' })
  @ApiParam({ name: 'id', description: 'Coin package UUID' })
  @ApiResponse({ status: 200, description: 'Package deactivated.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Package not found.' })
  deletePackage(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.deletePackage(id);
  }

  // ── Payment history (admin) ─────────────────────────────────────────────────

  @Get('history')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[Admin] Payment transaction history' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max records (default 100)' })
  @ApiResponse({ status: 200, description: 'List of payment logs.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getPayments(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.paymentsService.getPayments(limit);
  }

  // ── Checkout flow ───────────────────────────────────────────────────────────

  @Post('create-order')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a Razorpay order for a coin package purchase' })
  @ApiResponse({
    status: 201,
    description: 'Order created. Returns Razorpay order object + internal payment record.',
  })
  @ApiResponse({ status: 400, description: 'Razorpay gateway error.' })
  @ApiResponse({ status: 404, description: 'Coin package not found.' })
  createOrder(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateOrderDto,
  ) {
    return this.paymentsService.createOrder(req.user.id, dto.packageId);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify Razorpay payment and credit coins to wallet',
    description:
      'Pass razorpayOrderId + razorpayPaymentId + razorpaySignature from the Razorpay checkout callback. ' +
      'Coins are credited exactly once — duplicate calls are rejected with 409 Conflict.',
  })
  @ApiResponse({ status: 200, description: 'Verified — coins credited. Returns newBalance.' })
  @ApiResponse({ status: 400, description: 'Invalid signature or missing parameters.' })
  @ApiResponse({ status: 404, description: 'Payment record not found.' })
  @ApiResponse({ status: 409, description: 'Duplicate verify call — coins already credited.' })
  verify(@Body() dto: VerifyPaymentDto) {
    console.log('VERIFY REQUEST', dto);
    return this.paymentsService.verifyPayment(dto);
  }

  // ── Admin operations ────────────────────────────────────────────────────────

  @Post(':paymentId/refund')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Refund a successful payment and deduct coins' })
  @ApiParam({ name: 'paymentId', description: 'Internal payment UUID' })
  @ApiResponse({ status: 200, description: 'Refunded — coins deducted. Returns newBalance.' })
  @ApiResponse({ status: 400, description: 'Payment is not in success state.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  refund(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body('reason') reason?: string,
  ) {
    return this.paymentsService.refundPayment(paymentId, reason);
  }
}
