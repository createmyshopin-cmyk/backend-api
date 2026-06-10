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
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateGiftDto, UpdateGiftDto } from './dto/gift.dto';
import { GiftService } from './gift.service';

@ApiTags('Admin Gifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/gifts')
export class AdminGiftsController {
  constructor(private readonly giftService: GiftService) {}

  @Get('analytics')
  @Roles('super_admin', 'finance_admin', 'operations_admin')
  @ApiOperation({ summary: 'Gift revenue analytics (admin)' })
  analytics() {
    return this.giftService.getAdminAnalytics();
  }

  @Get()
  @Roles('super_admin', 'finance_admin', 'operations_admin')
  @ApiOperation({ summary: 'List all gifts (admin)' })
  list() {
    return this.giftService.listAllGiftsAdmin();
  }

  @Post()
  @Roles('super_admin', 'operations_admin')
  @ApiOperation({ summary: 'Create a gift (admin)' })
  create(@Body() dto: CreateGiftDto) {
    return this.giftService.createGiftAdmin(dto);
  }

  @Patch(':id')
  @Roles('super_admin', 'operations_admin')
  @ApiOperation({ summary: 'Update a gift (admin)' })
  update(@Param('id') id: string, @Body() dto: UpdateGiftDto) {
    return this.giftService.updateGiftAdmin(id, dto);
  }

  @Delete(':id')
  @Roles('super_admin', 'operations_admin')
  @ApiOperation({ summary: 'Soft-delete a gift (admin)' })
  @ApiResponse({ status: 200, description: 'Gift deactivated (soft delete).' })
  remove(@Param('id') id: string) {
    return this.giftService.deleteGiftAdmin(id);
  }
}
