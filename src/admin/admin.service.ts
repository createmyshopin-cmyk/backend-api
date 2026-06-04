import { Injectable } from '@nestjs/common';
import { UpdateSettingsDto, MaintenanceToggleDto } from './dto/admin.dto';

export interface SystemSettings {
  appName: string;
  supportEmail: string;
  supportWhatsapp: string;
  voiceCallsOn: boolean;
  videoCallsOn: boolean;
  callTimeout: number;
  coinRatePerMin: number;
  minRecharge: number;
  referralBonus: number;
  commissionRate: number;
  minWithdrawal: number;
  autoApproval: boolean;
  maintenanceMode: boolean;
}

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  joinedAt: string;
}

@Injectable()
export class AdminService {
  private settings: SystemSettings = {
    appName: 'CoinCalling',
    supportEmail: 'support@coincalling.com',
    supportWhatsapp: '+91 99999 88888',
    voiceCallsOn: true,
    videoCallsOn: true,
    callTimeout: 45,
    coinRatePerMin: 10,
    minRecharge: 99,
    referralBonus: 50,
    commissionRate: 60,
    minWithdrawal: 1000,
    autoApproval: false,
    maintenanceMode: false
  };

  private admins: AdminAccount[] = [
    { id: 'ADM001', name: 'Super Admin', email: 'admin@coincalling.com', role: 'super_admin', permissions: ['all'], joinedAt: '2026-01-01' },
    { id: 'ADM002', name: 'Rohan Fin', email: 'rohan.fin@coincalling.com', role: 'finance_admin', permissions: ['wallet', 'payments'], joinedAt: '2026-02-15' },
    { id: 'ADM003', name: 'Sarah Mod', email: 'sarah.mod@coincalling.com', role: 'moderator', permissions: ['users', 'calls', 'reports'], joinedAt: '2026-03-20' }
  ];

  async getSettings() {
    return this.settings;
  }

  async updateSettings(dto: UpdateSettingsDto) {
    this.settings = {
      ...this.settings,
      appName: dto.appName,
      supportEmail: dto.supportEmail,
      supportWhatsapp: dto.supportWhatsapp,
      callTimeout: dto.callTimeout,
      coinRatePerMin: dto.coinRatePerMin,
      commissionRate: dto.commissionRate
    };
    return this.settings;
  }

  async toggleMaintenance(dto: MaintenanceToggleDto) {
    this.settings.maintenanceMode = dto.enabled;
    return {
      message: `Maintenance mode is now ${dto.enabled ? 'ON' : 'OFF'}`,
      settings: this.settings
    };
  }

  async getAdmins() {
    return this.admins;
  }
}
