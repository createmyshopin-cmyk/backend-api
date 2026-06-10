import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { UsersService } from '../../users/users.service';
import { CreatorsService } from '../../creators/creators.service';
import { PaymentsService } from '../../payments/payments.service';
import { CallsService } from '../../calls/calls.service';
import { WithdrawalsService } from '../../withdrawals/withdrawals.service';
import { csvCell } from '../../common/csv.util';

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

        const [
          { data: todayRevData },
          { data: monthRevData },
          { data: totalRevData },
          { data: calls24 },
          { data: payments24 },
          { data: users24 },
          { data: creatorCalls24 },
          { data: creatorPayouts24 },
          pendingCountResult,
          { data: wPaid },
        ] = await Promise.all([
          client.from('payments').select('amount.sum()').eq('status', 'success').gte('created_at', todayStr),
          client.from('payments').select('amount.sum()').eq('status', 'success').gte('created_at', monthStr),
          client.from('payments').select('amount.sum(),coins_added.sum()').eq('status', 'success'),
          client.from('calls').select('caller_id').gte('created_at', last24h),
          client.from('payments').select('user_id').gte('created_at', last24h),
          client.from('users').select('id').gte('created_at', last24h),
          client.from('calls').select('creator_id').gte('created_at', last24h),
          client.from('withdrawals').select('creator_id').gte('created_at', last24h),
          client.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          client.from('withdrawals').select('amount.sum(),id.count()').eq('status', 'paid'),
        ]);

        const sumField = (row: Record<string, unknown> | undefined, field: string) =>
          Number((row?.[field] as { sum?: number | null } | undefined)?.sum ?? row?.sum ?? 0);

        const todayRevenue = sumField(todayRevData?.[0] as Record<string, unknown>, 'amount');
        const monthlyRevenue = sumField(monthRevData?.[0] as Record<string, unknown>, 'amount');
        const totalRevenue = sumField(totalRevData?.[0] as Record<string, unknown>, 'amount');
        const coinsSold = sumField(totalRevData?.[0] as Record<string, unknown>, 'coins_added');

        const activeUserIds = new Set([
          ...(calls24 || []).map(c => c.caller_id),
          ...(payments24 || []).map(p => p.user_id),
          ...(users24 || []).map(u => u.id),
        ]);
        const activeUsers = activeUserIds.size;

        const activeCreatorIds = new Set([
          ...(creatorCalls24 || []).map(c => c.creator_id),
          ...(creatorPayouts24 || []).map(w => w.creator_id),
        ]);
        const activeCreators = activeCreatorIds.size;

        const pendingWithdrawals = pendingCountResult.count ?? 0;
        const paidAgg = (wPaid?.[0] ?? {}) as {
          amount?: { sum: number | null };
          id?: { count: number | null };
        };
        const paidWithdrawals = Number(paidAgg.id?.count ?? 0);
        const creatorPayouts = Number(paidAgg.amount?.sum ?? 0);
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

        const [
          { data: dbPayments },
          { data: dbEarnings },
          { data: dbCalls },
          { data: dbWithdrawals },
        ] = await Promise.all([
          client
            .from('payments')
            .select('amount, coins_added, created_at')
            .eq('status', 'success')
            .gte('created_at', startDateStr),
          client
            .from('creator_earnings')
            .select('creator_share, created_at')
            .gte('created_at', startDateStr),
          client
            .from('calls')
            .select('id, created_at')
            .gte('created_at', startDateStr),
          client
            .from('withdrawals')
            .select('amount, created_at')
            .eq('status', 'paid')
            .gte('created_at', startDateStr),
        ]);

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
          .select('creator_id, creator_share, call_id');

        if (error) throw error;

        const creatorMap = new Map<string, { creatorId: string; totalEarnings: number; totalCalls: number; callIds: Set<string> }>();
        if (data) {
          for (const row of data) {
            const cid = row.creator_id as string;
            const earnings = Number(row.creator_share);
            let item = creatorMap.get(cid);
            if (!item) {
              item = { creatorId: cid, totalEarnings: 0, totalCalls: 0, callIds: new Set() };
              creatorMap.set(cid, item);
            }
            item.totalEarnings += earnings;
            item.totalCalls += 1;
            if (row.call_id) item.callIds.add(row.call_id as string);
          }
        }

        const top = Array.from(creatorMap.values())
          .sort((a, b) => b.totalEarnings - a.totalEarnings)
          .slice(0, 10);

        const topCreatorIds = top.map((t) => t.creatorId);
        const allCallIds = [...new Set(top.flatMap((t) => [...t.callIds]))];

        const [{ data: userRows }, { data: callRows }] = await Promise.all([
          topCreatorIds.length
            ? client.from('users').select('id, name, full_name').in('id', topCreatorIds)
            : Promise.resolve({ data: [] as Record<string, unknown>[] }),
          allCallIds.length
            ? client.from('calls').select('id, duration_seconds').in('id', allCallIds)
            : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        ]);

        const nameById = new Map<string, string>();
        for (const u of userRows ?? []) {
          nameById.set(
            u.id as string,
            (u.full_name as string) || (u.name as string) || 'Unknown',
          );
        }
        const durationByCallId = new Map<string, number>();
        for (const c of callRows ?? []) {
          durationByCallId.set(c.id as string, Number(c.duration_seconds ?? 0));
        }

        return top.map((item) => {
          let totalMinutes = 0;
          for (const callId of item.callIds) {
            totalMinutes += (durationByCallId.get(callId) ?? 0) / 60;
          }
          return {
            creatorName: nameById.get(item.creatorId) || 'Unknown',
            creatorId: item.creatorId,
            totalEarnings: item.totalEarnings,
            totalCalls: item.totalCalls,
            totalMinutes,
          };
        });
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
        const [{ data }, { data: totalPayments }] = await Promise.all([
          client.from('calls').select('status, duration_seconds, coins_spent'),
          client.from('payments').select('coins_added').eq('status', 'success'),
        ]);

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
        const rows = (data || []).map((r) =>
          [
            csvCell(r.id),
            csvCell(r.user_id),
            r.amount,
            r.coins_added,
            csvCell(r.gateway),
            csvCell(r.gateway_order_id),
            csvCell(r.created_at),
          ].join(','),
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
    const rows = filtered.map((r) =>
      [
        csvCell(r.id),
        csvCell(r.userId),
        r.amount,
        r.coins,
        csvCell(r.gateway),
        csvCell(r.gatewayOrderId),
        csvCell(r.createdAt),
      ].join(','),
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
        const rows = (data || []).map((r) =>
          [
            csvCell(r.id),
            csvCell(r.call_id || ''),
            csvCell(r.creator_id),
            r.gross_amount,
            r.creator_share,
            r.platform_share,
            csvCell(r.created_at),
          ].join(','),
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
    const rows = filtered.map((r) =>
      [
        csvCell(r.id),
        csvCell(r.callId || ''),
        csvCell(r.creatorId),
        r.grossAmount,
        r.creatorShare,
        r.platformShare,
        csvCell(r.createdAt),
      ].join(','),
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
        const rows = (data || []).map((r) => {
          const method = r.upi_id ? 'UPI' : 'Bank Transfer';
          return [
            csvCell(r.id),
            csvCell(r.creator_id),
            r.amount,
            csvCell(r.status),
            csvCell(method),
            csvCell(r.created_at),
          ].join(',');
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
    const rows = filtered.map((r) => {
      const method = r.upiId ? 'UPI' : 'Bank Transfer';
      return [
        csvCell(r.id),
        csvCell(r.creatorId),
        r.amount,
        csvCell(r.status),
        csvCell(method),
        csvCell(r.createdAt),
      ].join(',');
    }).join('\n');

    return headers + rows;
  }
}
