import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AdminOperationsService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    if (!this.supabase.isConfigured) {
      throw new BadRequestException('Database unavailable');
    }
    return this.supabase.getClient();
  }

  async getSnapshot() {
    const db = this.client();
    const since1h = new Date(Date.now() - 3600000).toISOString();

    const [
      activeCallsRes,
      onlineCreatorsRes,
      activeUsersRes,
      pendingPaymentsRes,
      pendingWithdrawalsRes,
      openFindingsRes,
      recentFailuresRes,
    ] = await Promise.all([
      db.from('calls').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('creator_profiles').select('id', { count: 'exact', head: true }).eq('online_status', 'online'),
      db.from('users').select('id', { count: 'exact', head: true }).eq('online_status', 'online'),
      db.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      db.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      db.from('reconciliation_findings').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      db.from('reconciliation_findings')
        .select('id, check_id, severity, entity_type, entity_id, last_seen_at')
        .eq('status', 'open')
        .in('severity', ['P0', 'P1'])
        .order('last_seen_at', { ascending: false })
        .limit(10),
    ]);

    const { data: recentPayments } = await db
      .from('payments')
      .select('id, amount_inr, status, created_at')
      .gte('created_at', since1h)
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: recentWithdrawals } = await db
      .from('withdrawals')
      .select('id, amount, status, created_at')
      .gte('created_at', since1h)
      .order('created_at', { ascending: false })
      .limit(5);

    return {
      timestamp: new Date().toISOString(),
      liveCalls: activeCallsRes.count ?? 0,
      onlineCreators: onlineCreatorsRes.count ?? 0,
      activeUsers: activeUsersRes.count ?? 0,
      pendingPayments: pendingPaymentsRes.count ?? 0,
      pendingWithdrawals: pendingWithdrawalsRes.count ?? 0,
      openFindings: openFindingsRes.count ?? 0,
      alerts: recentFailuresRes.data ?? [],
      recentPayments: recentPayments ?? [],
      recentWithdrawals: recentWithdrawals ?? [],
    };
  }
}
