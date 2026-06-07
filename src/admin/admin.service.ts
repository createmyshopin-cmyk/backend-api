import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateSettingsDto, MaintenanceToggleDto } from './dto/admin.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatorsService } from '../creators/creators.service';
import * as fs from 'fs';
import * as path from 'path';

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

  constructor(
    private readonly supabase: SupabaseService,
    private readonly creatorsService: CreatorsService,
  ) {}

  private getLocalConfigPath(): string {
    return path.resolve(process.cwd(), 'config', 'app_settings.json');
  }

  private loadLocalConfig(): Partial<SystemSettings> {
    try {
      const filePath = this.getLocalConfigPath();
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('AdminService.loadLocalConfig error:', (e as Error).message);
    }
    return {};
  }

  private saveLocalConfig(config: Partial<SystemSettings>) {
    try {
      const filePath = this.getLocalConfigPath();
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
      console.warn('AdminService.saveLocalConfig error:', (e as Error).message);
    }
  }

  async getSettings() {
    let settings = { ...this.settings };

    const localConfig = this.loadLocalConfig();
    settings = { ...settings, ...localConfig };

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { data, error } = await client
          .from('app_settings')
          .select('platform_commission_percent, min_withdrawal')
          .maybeSingle();
        if (!error && data) {
          if (data.platform_commission_percent !== null) {
            settings.commissionRate = Number(data.platform_commission_percent);
          }
          if (data.min_withdrawal !== null) {
            settings.minWithdrawal = Number(data.min_withdrawal);
          }
        }
      } catch (e) {
        console.warn('AdminService.getSettings Supabase error:', (e as Error).message);
      }
    }

    return settings;
  }

  async updateSettings(dto: UpdateSettingsDto) {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { data: existing } = await client
          .from('app_settings')
          .select('id')
          .maybeSingle();

        const payload = {
          platform_commission_percent: dto.commissionRate,
          min_withdrawal: dto.minWithdrawal ?? 1000,
          updated_at: new Date().toISOString(),
        };

        if (existing?.id) {
          await client
            .from('app_settings')
            .update(payload)
            .eq('id', existing.id);
        } else {
          await client
            .from('app_settings')
            .insert({
              id: '00000000-0000-0000-0000-000000000000',
              ...payload
            });
        }
      } catch (e) {
        console.warn('AdminService.updateSettings Supabase error:', (e as Error).message);
      }
    }

    const currentLocal = this.loadLocalConfig();
    const updatedLocal: Partial<SystemSettings> = {
      ...currentLocal,
      appName: dto.appName,
      supportEmail: dto.supportEmail,
      supportWhatsapp: dto.supportWhatsapp,
      callTimeout: dto.callTimeout,
      coinRatePerMin: dto.coinRatePerMin,
      commissionRate: dto.commissionRate,
      minWithdrawal: dto.minWithdrawal ?? 1000,
    };
    this.saveLocalConfig(updatedLocal);

    this.settings = {
      ...this.settings,
      ...updatedLocal,
    };

    return this.getSettings();
  }

  async toggleMaintenance(dto: MaintenanceToggleDto) {
    const localConfig = this.loadLocalConfig();
    localConfig.maintenanceMode = dto.enabled;
    this.saveLocalConfig(localConfig);

    this.settings.maintenanceMode = dto.enabled;
    return {
      message: `Maintenance mode is now ${dto.enabled ? 'ON' : 'OFF'}`,
      settings: await this.getSettings()
    };
  }

  async getAdmins() {
    return this.admins;
  }

  async getDashboardStats() {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();

        const { count: totalUsers } = await client
          .from('users')
          .select('*', { count: 'exact', head: true });

        const { count: totalListeners } = await client
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('is_creator', true);

        const { count: pendingApplications } = await client
          .from('users')
          .select('id, creator_profiles!inner()')
          .eq('is_creator', false);

        const { count: activeListenersOnline } = await client
          .from('creator_profiles')
          .select('*', { count: 'exact', head: true })
          .or('is_online.eq.true,online_status.eq.true');

        const { count: totalCalls } = await client
          .from('calls')
          .select('*', { count: 'exact', head: true });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { count: todaysCalls } = await client
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString());

        const { data: callCoins } = await client
          .from('calls')
          .select('coins_spent, coins_deducted');
        const totalCoinsSpent = (callCoins ?? []).reduce(
          (sum, c) => sum + (c.coins_spent ?? c.coins_deducted ?? 0),
          0,
        );

        const { data: successfulPayments } = await client
          .from('payments')
          .select('amount')
          .eq('status', 'success');
        const platformRevenue = (successfulPayments ?? []).reduce(
          (sum, p) => sum + Number(p.amount ?? 0),
          0,
        );

        const { count: pendingWithdrawals } = await client
          .from('withdrawals')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        return {
          totalUsers: totalUsers ?? 0,
          totalListeners: totalListeners ?? 0,
          pendingApplications: pendingApplications ?? 0,
          activeListenersOnline: activeListenersOnline ?? 0,
          totalCalls: totalCalls ?? 0,
          todaysCalls: todaysCalls ?? 0,
          totalCoinsSpent,
          platformRevenue,
          pendingWithdrawals: pendingWithdrawals ?? 0,
        };
      } catch (e) {
        console.warn('AdminService.getDashboardStats Supabase error:', (e as Error).message);
      }
    }

    const activeOnlineCount = (await this.creatorsService.getActive()).filter(c => c.isOnline).length;
    const pendingCount = (await this.creatorsService.getPending()).length;

    return {
      totalUsers: 15,
      totalListeners: 6,
      pendingApplications: pendingCount || 2,
      activeListenersOnline: activeOnlineCount || 3,
      totalCalls: 245,
      todaysCalls: 12,
      totalCoinsSpent: 45000,
      platformRevenue: 15600,
      pendingWithdrawals: 1,
    };
  }

  async getListeners(status?: string) {
    if (status === 'pending') {
      return this.creatorsService.getPending();
    } else if (status === 'suspended') {
      return this.creatorsService.getSuspended();
    } else if (status === 'rejected') {
      return this.creatorsService.getRejected();
    } else {
      return this.creatorsService.getActive();
    }
  }

  async getListenerDetail(id: string) {
    const creator = await this.creatorsService.findOne(id);
    return this.creatorsService.mapToDto(creator);
  }

  async getTransactions(page = 1, limit = 20, type?: string) {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        let q = client
          .from('coin_transactions')
          .select('*, users(name, full_name, email)', { count: 'exact' });

        if (type && type !== 'all') {
          q = q.eq('type', type);
        }

        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, count, error } = await q
          .order('created_at', { ascending: false })
          .range(from, to);

        if (error) throw new Error(error.message);

        return {
          transactions: (data ?? []).map((t: any) => ({
            id: t.id,
            userId: t.user_id,
            userName: t.users?.full_name || t.users?.name || 'User',
            amount: t.amount,
            type: t.type,
            description: t.description,
            createdAt: t.created_at,
          })),
          total: count ?? 0,
        };
      } catch (e) {
        console.warn('AdminService.getTransactions Supabase error:', (e as Error).message);
      }
    }

    return {
      transactions: [
        { id: 'TXN1001', userId: 'USR001', userName: 'Aarav Sharma', amount: 100, type: 'credit', description: 'Recharge Pack', createdAt: new Date().toISOString() },
        { id: 'TXN1002', userId: 'USR002', userName: 'Rohan Mehta', amount: -50, type: 'debit', description: 'Call deduction', createdAt: new Date().toISOString() },
      ],
      total: 2,
    };
  }

  async getEarnings() {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { data, error } = await client
          .from('creator_earnings')
          .select('*, users(name, full_name)')
          .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        return (data ?? []).map((e: any) => ({
          id: e.id,
          callId: e.call_id,
          creatorId: e.creator_id,
          creatorName: e.users?.full_name || e.users?.name || 'Host',
          grossAmount: Number(e.gross_amount ?? 0),
          commissionAmount: Number(e.commission_amount ?? 0),
          netAmount: Number(e.net_amount ?? 0),
          createdAt: e.created_at,
        }));
      } catch (e) {
        console.warn('AdminService.getEarnings Supabase error:', (e as Error).message);
      }
    }

    return [
      { id: 'ERN001', callId: 'CALL001', creatorId: 'CRT001', creatorName: 'Anjali', grossAmount: 100, commissionAmount: 30, netAmount: 70, createdAt: new Date().toISOString() },
    ];
  }
}
