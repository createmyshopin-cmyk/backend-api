import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CreateGiftDto, UpdateGiftDto } from './dto/gift.dto';
import { GiftService } from './gift.service';

@ApiTags('Admin Gifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/gifts')
export class AdminGiftsController {
  constructor(private readonly giftService: GiftService) {}

  @Get('analytics')
  @ApiOperation({ summary: 'Gift revenue analytics (admin)' })
  analytics() {
    return this.giftService.getAdminAnalytics();
  }

  @Get()
  @ApiOperation({ summary: 'List all gifts (admin)' })
  list() {
    return this.giftService.listAllGiftsAdmin();
  }

  @Post()
  @ApiOperation({ summary: 'Create a gift (admin)' })
  create(@Body() dto: CreateGiftDto) {
    return this.giftService.createGiftAdmin(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a gift (admin)' })
  update(@Param('id') id: string, @Body() dto: UpdateGiftDto) {
    return this.giftService.updateGiftAdmin(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a gift (admin)' })
  @ApiResponse({ status: 200, description: 'Gift deactivated (soft delete).' })
  remove(@Param('id') id: string) {
    return this.giftService.deleteGiftAdmin(id);
  }
}
