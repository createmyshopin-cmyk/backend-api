import { Controller, Post, Headers, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { RazorpayWebhookService } from './razorpay-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('Webhooks')
@ApiExcludeController()
@Controller('webhooks')
export class RazorpayWebhookController {
  constructor(private readonly webhookService: RazorpayWebhookService) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay payment webhook (HMAC verified)' })
  handle(
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Req() req: RawBodyRequest,
  ) {
    const rawBody =
      req.rawBody ??
      Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    return this.webhookService.handle(rawBody, signature);
  }
}
