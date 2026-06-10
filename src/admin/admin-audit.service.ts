import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import type { AdminRequestUser } from '../auth/admin-user.types';

export type AuditCategory =
  | 'auth'
  | 'authz'
  | 'admin_lifecycle'
  | 'user'
  | 'creator'
  | 'wallet'
  | 'payment'
  | 'withdrawal'
  | 'gift'
  | 'settings'
  | 'export'
  | 'system';

export type AuditOutcome = 'success' | 'denied' | 'error' | 'partial';

export interface AuditEvent {
  actorType: 'admin' | 'system' | 'webhook' | 'creator';
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  resourceType: string;
  resourceId: string;
  httpMethod?: string;
  httpPath?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  details?: Record<string, unknown>;
  retentionClass?: 'financial' | 'standard' | 'security';
}

export interface AuditQueryFilters {
  from?: string;
  to?: string;
  action?: string;
  category?: string;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  outcome?: string;
  cursor?: string;
  limit?: number;
  allowedCategories?: string[];
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);
  private readonly memLogs: Record<string, unknown>[] = [];

  constructor(private readonly supabase: SupabaseService) {}

  private redactDetails(details: Record<string, unknown>): Record<string, unknown> {
    const out = { ...details };
    if (typeof out.bank_account_number === 'string' && out.bank_account_number.length > 4) {
      out.bank_account_number = `****${out.bank_account_number.slice(-4)}`;
    }
    if (typeof out.upi_id === 'string' && out.upi_id.includes('@')) {
      const [, provider] = out.upi_id.split('@');
      out.upi_id = `***@${provider}`;
    }
    return out;
  }

  async record(event: AuditEvent): Promise<string> {
    const row = {
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      actor_email: event.actorEmail ?? null,
      actor_role: event.actorRole ?? null,
      action: event.action,
      category: event.category,
      outcome: event.outcome,
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      http_method: event.httpMethod ?? null,
      http_path: event.httpPath ?? null,
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent?.slice(0, 512) ?? null,
      request_id: event.requestId ?? null,
      correlation_id: event.correlationId ?? null,
      idempotency_key: event.idempotencyKey ?? null,
      details: this.redactDetails(event.details ?? {}),
      retention_class: event.retentionClass ?? 'standard',
    };

    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('admin_audit_logs')
        .insert(row)
        .select('id')
        .single();
      if (error) {
        this.logger.error(`Audit insert failed: ${error.message}`, { action: event.action });
        if (event.retentionClass === 'financial' || event.category === 'wallet' ||
            event.category === 'payment' || event.category === 'withdrawal') {
          throw new Error(`Financial audit insert failed: ${error.message}`);
        }
        return '';
      }
      return data.id as string;
    }

    const id = crypto.randomUUID();
    this.memLogs.unshift({ id, occurred_at: new Date().toISOString(), ...row });
    return id;
  }

  /** Same-transaction insert — caller passes Supabase client from rpc/transaction when available. */
  async recordWithClient(client: SupabaseClient, event: AuditEvent): Promise<string> {
    const row = {
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      actor_email: event.actorEmail ?? null,
      actor_role: event.actorRole ?? null,
      action: event.action,
      category: event.category,
      outcome: event.outcome,
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      http_method: event.httpMethod ?? null,
      http_path: event.httpPath ?? null,
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent?.slice(0, 512) ?? null,
      request_id: event.requestId ?? null,
      correlation_id: event.correlationId ?? null,
      idempotency_key: event.idempotencyKey ?? null,
      details: this.redactDetails(event.details ?? {}),
      retention_class: event.retentionClass ?? 'financial',
    };

    const { data, error } = await client
      .from('admin_audit_logs')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Audit insert failed in transaction: ${error.message}`);
    }
    return data.id;
  }

  async query(filters: AuditQueryFilters): Promise<{ data: unknown[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(filters.limit ?? 50, 200);

    if (!this.supabase.isConfigured) {
      let rows = [...this.memLogs];
      if (filters.allowedCategories?.length) {
        rows = rows.filter((r) => filters.allowedCategories!.includes(String(r.category)));
      }
      return { data: rows.slice(0, limit), nextCursor: null, hasMore: false };
    }

    let q = this.supabase
      .getClient()
      .from('admin_audit_logs')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit + 1);

    if (filters.from) q = q.gte('occurred_at', filters.from);
    if (filters.to) q = q.lte('occurred_at', filters.to);
    if (filters.action) q = q.eq('action', filters.action);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.actorId) q = q.eq('actor_id', filters.actorId);
    if (filters.resourceType) q = q.eq('resource_type', filters.resourceType);
    if (filters.resourceId) q = q.eq('resource_id', filters.resourceId);
    if (filters.outcome) q = q.eq('outcome', filters.outcome);
    if (filters.allowedCategories?.length) {
      q = q.in('category', filters.allowedCategories);
    }

    const { data, error } = await q;
    if (error) {
      this.logger.error(`Audit query failed: ${error.message}`);
      return { data: [], nextCursor: null, hasMore: false };
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && page.length ? String(page[page.length - 1].id) : null;
    return { data: page, nextCursor, hasMore };
  }

  actorFromRequest(
    user: AdminRequestUser | undefined,
    req?: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ): Pick<AuditEvent, 'actorType' | 'actorId' | 'actorEmail' | 'actorRole' | 'ipAddress' | 'userAgent'> {
    const ua = req?.headers?.['user-agent'];
    return {
      actorType: 'admin',
      actorId: user?.id,
      actorEmail: user?.email,
      actorRole: user?.role,
      ipAddress: req?.ip,
      userAgent: typeof ua === 'string' ? ua : undefined,
    };
  }
}
