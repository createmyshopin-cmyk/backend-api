import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { UsersService } from '../../users/users.service';
import { CreatorsService } from '../../creators/creators.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { CallsService } from '../../calls/calls.service';
import { WithdrawalsService } from '../../withdrawals/withdrawals.service';

@Injectable()
export class FinanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly usersService: UsersService,
    private readonly creatorsService: CreatorsService,
    private readonly paymentsService: PaymentsService,
    private readonly callsService: CallsService,
    private readonly withdrawalsService: WithdrawalsService,
  ) {}

  private parseDateRange(range?: string, startDate?: string, endDate?: string) {
    let start: Date | null = null;
    let end: Date | null = null;

    if (range === 'today') {
      start = new Date();
      start.setHours(0, 0, 0, 0);
      end = new Date();
      end.setHours(23, 59, 59, 999);
    } else if (range === '7days') {
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      end = new Date();
    } else if (range === '30days') {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      end = new Date();
    } else if (range === 'custom' && startDate) {
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      if (endDate) {
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      } else {
        end = new Date();
      }
    }

    return { start, end };
  }

  async getOverview() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStr = startOfToday.toISOString();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthStr = startOfMonth.toISOString();

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();

        // 1. Revenue queries
        const { data: todayRevData } = await client
          .from('payments')
          .select('amount')
          .eq('status', 'success')
          .gte('created_at', todayStr);

        const { data: monthRevData } = await client
          .from('payments')
          .select('amount')
          .eq('status', 'success')
          .gte('created_at', monthStr);

        const { data: totalRevData } = await client
          .from('payments')
          .select('amount, coins_added')
          .eq('status', 'success');

        const todayRevenue = todayRevData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
        const monthlyRevenue = monthRevData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
        const totalRevenue = totalRevData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
        const coinsSold = totalRevData?.reduce((sum, p) => sum + Number(p.coins_added), 0) || 0;

        // 2. Active users (distinct users with login/created_at, call or payment in last 24h)
        const { data: calls24 } = await client.from('calls').select('caller_id').gte('created_at', last24h);
        const { data: payments24 } = await client.from('payments').select('user_id').gte('created_at', last24h);
        const { data: users24 } = await client.from('users').select('id').gte('created_at', last24h);
        
        const activeUserIds = new Set([
          ...(calls24 || []).map(c => c.caller_id),
          ...(payments24 || []).map(p => p.user_id),
          ...(users24 || []).map(u => u.id),
        ]);
        const activeUsers = activeUserIds.size;

        // 3. Active creators (calls or payouts in last 24h)
        const { data: creatorCalls24 } = await client.from('calls').select('creator_id').gte('created_at', last24h);
        const { data: creatorPayouts24 } = await client.from('withdrawals').select('creator_id').gte('created_at', last24h);
        
        const activeCreatorIds = new Set([
          ...(creatorCalls24 || []).map(c => c.creator_id),
          ...(creatorPayouts24 || []).map(w => w.creator_id),
        ]);
        const activeCreators = activeCreatorIds.size;

        // 4. Withdrawals
        const { data: wPending } = await client.from('withdrawals').select('amount').eq('status', 'pending');
        const { data: wPaid } = await client.from('withdrawals').select('amount').eq('status', 'paid');

        const pendingWithdrawals = wPending?.length || 0;
        const paidWithdrawals = wPaid?.length || 0;
        const creatorPayouts = wPaid?.reduce((sum, w) => sum + Number(w.amount), 0) || 0;
        const platformProfit = totalRevenue - creatorPayouts;

        return {
          todayRevenue,
          monthlyRevenue,
          totalRevenue,
          coinsSold,
          activeUsers,
          activeCreators,
          pendingWithdrawals,
          paidWithdrawals,
          creatorPayouts,
          platformProfit,
        };
      } catch (e) {
        console.warn('FinanceService.getOverview database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memPayments = this.paymentsService.getMemPayments();
    const memCalls = this.callsService.getMemCalls();
    const memUsers = this.usersService.getMemUsers();
    const memWithdrawals = this.withdrawalsService.getMemWithdrawals();

    const todayDate = new Date(todayStr);
    const monthDate = new Date(monthStr);
    const last24hDate = new Date(last24h);

    const todayRevenue = memPayments
      .filter(p => p.status === 'success' && new Date(p.createdAt) >= todayDate)
      .reduce((sum, p) => sum + p.amount, 0);

    const monthlyRevenue = memPayments
      .filter(p => p.status === 'success' && new Date(p.createdAt) >= monthDate)
      .reduce((sum, p) => sum + p.amount, 0);

    const totalRevenue = memPayments
      .filter(p => p.status === 'success')
      .reduce((sum, p) => sum + p.amount, 0);

    const coinsSold = memPayments
      .filter(p => p.status === 'success')
      .reduce((sum, p) => sum + p.coins, 0);

    const activeUserIds = new Set([
      ...memCalls.filter(c => new Date(c.startedAt) >= last24hDate).map(c => c.callerId),
      ...memPayments.filter(p => new Date(p.createdAt) >= last24hDate).map(p => p.userId),
      ...memUsers.filter(u => new Date(u.registeredAt) >= last24hDate).map(u => u.id),
    ]);
    const activeUsers = activeUserIds.size;

    const activeCreatorIds = new Set([
      ...memCalls.filter(c => new Date(c.startedAt) >= last24hDate).map(c => c.creatorId),
      ...memWithdrawals.filter(w => new Date(w.createdAt) >= last24hDate).map(w => w.creatorId),
    ]);
    const activeCreators = activeCreatorIds.size;

    const pendingWithdrawals = memWithdrawals.filter(w => w.status === 'pending').length;
    const paidWithdrawals = memWithdrawals.filter(w => w.status === 'paid').length;
    const creatorPayouts = memWithdrawals.filter(w => w.status === 'paid').reduce((sum, w) => sum + w.amount, 0);
    const platformProfit = totalRevenue - creatorPayouts;

    return {
      todayRevenue,
      monthlyRevenue,
      totalRevenue,
      coinsSold,
      activeUsers,
      activeCreators,
      pendingWithdrawals,
      paidWithdrawals,
      creatorPayouts,
      platformProfit,
    };
  }

  async getRevenueChart(days: number) {
    const trendData = [];
    const map = new Map<string, any>();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const entry = {
        date: dateStr,
        revenue: 0,
        coinsSold: 0,
        creatorEarnings: 0,
        callVolume: 0,
        withdrawals: 0,
      };
      trendData.push(entry);
      map.set(dateStr, entry);
    }

    const startDateStr = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();

        const { data: dbPayments } = await client
          .from('payments')
          .select('amount, coins_added, created_at')
          .eq('status', 'success')
          .gte('created_at', startDateStr);

        const { data: dbEarnings } = await client
          .from('creator_earnings')
          .select('creator_share, created_at')
          .gte('created_at', startDateStr);

        const { data: dbCalls } = await client
          .from('calls')
          .select('id, created_at')
          .gte('created_at', startDateStr);

        const { data: dbWithdrawals } = await client
          .from('withdrawals')
          .select('amount, created_at')
          .eq('status', 'paid')
          .gte('created_at', startDateStr);

        if (dbPayments) {
          for (const p of dbPayments) {
            const key = p.created_at.split('T')[0];
            const bucket = map.get(key);
            if (bucket) {
              bucket.revenue += Number(p.amount);
              bucket.coinsSold += Number(p.coins_added);
            }
          }
        }

        if (dbEarnings) {
          for (const e of dbEarnings) {
            const key = e.created_at.split('T')[0];
            const bucket = map.get(key);
            if (bucket) {
              bucket.creatorEarnings += Number(e.creator_share);
            }
          }
        }

        if (dbCalls) {
          for (const c of dbCalls) {
            const key = c.created_at.split('T')[0];
            const bucket = map.get(key);
            if (bucket) {
              bucket.callVolume += 1;
            }
          }
        }

        if (dbWithdrawals) {
          for (const w of dbWithdrawals) {
            const key = w.created_at.split('T')[0];
            const bucket = map.get(key);
            if (bucket) {
              bucket.withdrawals += Number(w.amount);
            }
          }
        }

        return trendData;
      } catch (e) {
        console.warn('FinanceService.getRevenueChart database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memPayments = this.paymentsService.getMemPayments();
    const memCalls = this.callsService.getMemCalls();
    const memEarnings = this.creatorsService.getMemEarnings();
    const memWithdrawals = this.withdrawalsService.getMemWithdrawals();

    for (const p of memPayments) {
      if (p.status === 'success') {
        const key = p.createdAt.split('T')[0];
        const bucket = map.get(key);
        if (bucket) {
          bucket.revenue += p.amount;
          bucket.coinsSold += p.coins;
        }
      }
    }

    for (const e of memEarnings) {
      const key = e.createdAt.split('T')[0];
      const bucket = map.get(key);
      if (bucket) {
        bucket.creatorEarnings += Number(e.creatorShare);
      }
    }

    for (const c of memCalls) {
      const key = c.startedAt.split('T')[0];
      const bucket = map.get(key);
      if (bucket) {
        bucket.callVolume += 1;
      }
    }

    for (const w of memWithdrawals) {
      if (w.status === 'paid') {
        const key = w.createdAt.split('T')[0];
        const bucket = map.get(key);
        if (bucket) {
          bucket.withdrawals += w.amount;
        }
      }
    }

    return trendData;
  }

  async getTopCreators() {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { data, error } = await client
          .from('creator_earnings')
          .select(`
            creator_id,
            creator_share,
            users (
              name
            ),
            calls (
              duration_seconds
            )
          `);

        if (error) throw error;

        const creatorMap = new Map<string, any>();
        if (data) {
          for (const row of data) {
            const cid = row.creator_id;
            const name = (row.users as any)?.name || 'Unknown';
            const earnings = Number(row.creator_share);
            const durationSec = Number((row.calls as any)?.duration_seconds || 0);

            let item = creatorMap.get(cid);
            if (!item) {
              item = { creatorName: name, creatorId: cid, totalEarnings: 0, totalCalls: 0, totalMinutes: 0 };
              creatorMap.set(cid, item);
            }
            item.totalEarnings += earnings;
            item.totalCalls += 1;
            item.totalMinutes += durationSec / 60;
          }
        }

        return Array.from(creatorMap.values())
          .sort((a, b) => b.totalEarnings - a.totalEarnings)
          .slice(0, 10);
      } catch (e) {
        console.warn('FinanceService.getTopCreators database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memEarnings = this.creatorsService.getMemEarnings();
    const memCalls = this.callsService.getMemCalls();
    const memCreators = this.creatorsService.getMemCreators();

    const creatorMap = new Map<string, any>();
    for (const e of memEarnings) {
      const cid = e.creatorId;
      const creator = memCreators.find(c => c.id === cid);
      const name = creator ? creator.name : 'Unknown';
      const call = memCalls.find(c => c.id === e.callId);
      const durationSec = call ? call.durationSeconds : 0;

      let item = creatorMap.get(cid);
      if (!item) {
        item = { creatorName: name, creatorId: cid, totalEarnings: 0, totalCalls: 0, totalMinutes: 0 };
        creatorMap.set(cid, item);
      }
      item.totalEarnings += e.creatorShare;
      item.totalCalls += 1;
      item.totalMinutes += durationSec / 60;
    }

    return Array.from(creatorMap.values())
      .sort((a, b) => b.totalEarnings - a.totalEarnings)
      .slice(0, 10);
  }

  async getCallAnalytics() {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { data } = await client
          .from('calls')
          .select('status, duration_seconds, coins_spent');

        // Total payments to sum coins sold
        const { data: totalPayments } = await client
          .from('payments')
          .select('coins_added')
          .eq('status', 'success');

        const totalCalls = data?.length || 0;
        const completedCalls = data?.filter(c => c.status === 'ended').length || 0;
        const totalDurationSeconds = data?.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) || 0;
        const totalCallMinutes = totalDurationSeconds / 60;
        const averageCallDuration = totalCalls > 0 ? (totalDurationSeconds / totalCalls) : 0;
        const coinsUsed = data?.reduce((sum, c) => sum + (c.coins_spent || 0), 0) || 0;
        const coinsSold = totalPayments?.reduce((sum, p) => sum + Number(p.coins_added), 0) || 0;
        const outstandingCoins = coinsSold - coinsUsed;

        return {
          totalCalls,
          completedCalls,
          totalCallMinutes,
          averageCallDuration,
          coinsUsed,
          outstandingCoins,
        };
      } catch (e) {
        console.warn('FinanceService.getCallAnalytics database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memCalls = this.callsService.getMemCalls();
    const memPayments = this.paymentsService.getMemPayments();

    const totalCalls = memCalls.length;
    const completedCalls = memCalls.filter(c => c.status === 'ended').length;
    const totalDurationSeconds = memCalls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);
    const totalCallMinutes = totalDurationSeconds / 60;
    const averageCallDuration = totalCalls > 0 ? (totalDurationSeconds / totalCalls) : 0;
    const coinsUsed = memCalls.reduce((sum, c) => sum + (c.coinsSpent || c.coinsDeducted || 0), 0);
    const coinsSold = memPayments.filter(p => p.status === 'success').reduce((sum, p) => sum + p.coins, 0);
    const outstandingCoins = coinsSold - coinsUsed;

    return {
      totalCalls,
      completedCalls,
      totalCallMinutes,
      averageCallDuration,
      coinsUsed,
      outstandingCoins,
    };
  }

  async getWithdrawalAnalytics() {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { data } = await client
          .from('withdrawals')
          .select('status, amount');

        const pendingWithdrawals = data?.filter(w => w.status === 'pending').length || 0;
        const pendingAmount = data?.filter(w => w.status === 'pending').reduce((sum, w) => sum + Number(w.amount), 0) || 0;
        const paidWithdrawals = data?.filter(w => w.status === 'paid').length || 0;
        const totalPayouts = data?.filter(w => w.status === 'paid').reduce((sum, w) => sum + Number(w.amount), 0) || 0;

        return {
          pendingWithdrawals,
          pendingAmount,
          paidWithdrawals,
          totalPayouts,
        };
      } catch (e) {
        console.warn('FinanceService.getWithdrawalAnalytics database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memWithdrawals = this.withdrawalsService.getMemWithdrawals();
    const pendingWithdrawals = memWithdrawals.filter(w => w.status === 'pending').length;
    const pendingAmount = memWithdrawals.filter(w => w.status === 'pending').reduce((sum, w) => sum + w.amount, 0);
    const paidWithdrawals = memWithdrawals.filter(w => w.status === 'paid').length;
    const totalPayouts = memWithdrawals.filter(w => w.status === 'paid').reduce((sum, w) => sum + w.amount, 0);

    return {
      pendingWithdrawals,
      pendingAmount,
      paidWithdrawals,
      totalPayouts,
    };
  }

  async exportRevenueCsv(range?: string, startDate?: string, endDate?: string) {
    const { start, end } = this.parseDateRange(range, startDate, endDate);

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        let query = client
          .from('payments')
          .select('id, user_id, amount, coins_added, gateway, gateway_order_id, created_at')
          .eq('status', 'success')
          .order('created_at', { ascending: false });

        if (start) query = query.gte('created_at', start.toISOString());
        if (end) query = query.lte('created_at', end.toISOString());

        const { data } = await query;
        const headers = 'ID,User ID,Amount (₹),Coins Added,Gateway,Order ID,Date\n';
        const rows = (data || []).map(r => 
          `"${r.id}","${r.user_id}",${r.amount},${r.coins_added},"${r.gateway}","${r.gateway_order_id}","${r.created_at}"`
        ).join('\n');

        return headers + rows;
      } catch (e) {
        console.warn('FinanceService.exportRevenueCsv database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memPayments = this.paymentsService.getMemPayments();
    const filtered = memPayments.filter(p => {
      if (p.status !== 'success') return false;
      const d = new Date(p.createdAt);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    const headers = 'ID,User ID,Amount (₹),Coins Added,Gateway,Order ID,Date\n';
    const rows = filtered.map(r =>
      `"${r.id}","${r.userId}",${r.amount},${r.coins},"${r.gateway}","${r.gatewayOrderId}","${r.createdAt}"`
    ).join('\n');

    return headers + rows;
  }

  async exportEarningsCsv(range?: string, startDate?: string, endDate?: string) {
    const { start, end } = this.parseDateRange(range, startDate, endDate);

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        let query = client
          .from('creator_earnings')
          .select('id, call_id, creator_id, gross_amount, creator_share, platform_share, created_at')
          .order('created_at', { ascending: false });

        if (start) query = query.gte('created_at', start.toISOString());
        if (end) query = query.lte('created_at', end.toISOString());

        const { data } = await query;
        const headers = 'ID,Call ID,Creator ID,Gross Amount (Coins),Creator Share (Coins),Platform Share (Coins),Date\n';
        const rows = (data || []).map(r => 
          `"${r.id}","${r.call_id || ''}","${r.creator_id}",${r.gross_amount},${r.creator_share},${r.platform_share},"${r.created_at}"`
        ).join('\n');

        return headers + rows;
      } catch (e) {
        console.warn('FinanceService.exportEarningsCsv database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memEarnings = this.creatorsService.getMemEarnings();
    const filtered = memEarnings.filter(e => {
      const d = new Date(e.createdAt);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    const headers = 'ID,Call ID,Creator ID,Gross Amount (Coins),Creator Share (Coins),Platform Share (Coins),Date\n';
    const rows = filtered.map(r => 
      `"${r.id}","${r.callId || ''}","${r.creatorId}",${r.grossAmount},${r.creatorShare},${r.platformShare},"${r.createdAt}"`
    ).join('\n');

    return headers + rows;
  }

  async exportWithdrawalsCsv(range?: string, startDate?: string, endDate?: string) {
    const { start, end } = this.parseDateRange(range, startDate, endDate);

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        let query = client
          .from('withdrawals')
          .select('id, creator_id, amount, status, bank_account_name, upi_id, created_at')
          .order('created_at', { ascending: false });

        if (start) query = query.gte('created_at', start.toISOString());
        if (end) query = query.lte('created_at', end.toISOString());

        const { data } = await query;
        const headers = 'ID,Creator ID,Amount (₹),Status,Method,Requested At\n';
        const rows = (data || []).map(r => {
          const method = r.upi_id ? 'UPI' : 'Bank Transfer';
          return `"${r.id}","${r.creator_id}",${r.amount},"${r.status}","${method}","${r.created_at}"`;
        }).join('\n');

        return headers + rows;
      } catch (e) {
        console.warn('FinanceService.exportWithdrawalsCsv database error:', (e as Error).message);
      }
    }

    // In-memory fallback
    const memWithdrawals = this.withdrawalsService.getMemWithdrawals();
    const filtered = memWithdrawals.filter(w => {
      const d = new Date(w.createdAt);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    const headers = 'ID,Creator ID,Amount (₹),Status,Method,Requested At\n';
    const rows = filtered.map(r => {
      const method = r.upiId ? 'UPI' : 'Bank Transfer';
      return `"${r.id}","${r.creatorId}",${r.amount},"${r.status}","${method}","${r.createdAt}"`;
    }).join('\n');

    return headers + rows;
  }
}
