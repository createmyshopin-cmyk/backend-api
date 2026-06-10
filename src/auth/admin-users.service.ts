import {
  Injectable,
  Logger,
  OnModuleInit,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { AdminRole } from './admin-roles';
import { isAdminRole } from './admin-roles';
import type { AdminSessionRecord, AdminUserRecord } from './admin-user.types';

const BCRYPT_ROUNDS = 12;
const INVITE_TTL_HOURS = 72;

@Injectable()
export class AdminUsersService implements OnModuleInit {
  private readonly logger = new Logger(AdminUsersService.name);
  private readonly memAdmins = new Map<string, AdminUserRecord>();
  private readonly memSessions = new Map<string, AdminSessionRecord>();
  private readonly memInvites = new Map<string, Record<string, unknown>>();

  constructor(private readonly supabase: SupabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrapSeedAdmin();
  }

  private async bootstrapSeedAdmin(): Promise<void> {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
    if (!email || !password) return;

    const existing = await this.findByEmail(email);
    if (existing) return;

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.insertAdmin({
      email,
      password_hash: hash,
      name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Bootstrap Super Admin',
      role: 'super_admin',
      created_by: null,
    });
    this.logger.log(`Bootstrap super_admin created for ${email}`);
  }

  private client() {
    return this.supabase.getClient();
  }

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    const normalized = email.trim().toLowerCase();
    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_users')
        .select('*')
        .ilike('email', normalized)
        .maybeSingle();
      if (error) {
        this.logger.warn(`findByEmail error: ${error.message}`);
        return this.memAdmins.get(normalized) ?? null;
      }
      return data as AdminUserRecord | null;
    }
    return this.memAdmins.get(normalized) ?? null;
  }

  async findById(id: string): Promise<AdminUserRecord | null> {
    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_users')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        this.logger.warn(`findById error: ${error.message}`);
        return [...this.memAdmins.values()].find((a) => a.id === id) ?? null;
      }
      return data as AdminUserRecord | null;
    }
    return [...this.memAdmins.values()].find((a) => a.id === id) ?? null;
  }

  async verifyPassword(admin: AdminUserRecord, password: string): Promise<boolean> {
    return bcrypt.compare(password, admin.password_hash);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  private async insertAdmin(params: {
    email: string;
    password_hash: string;
    name: string;
    role: AdminRole;
    created_by: string | null;
  }): Promise<AdminUserRecord> {
    const email = params.email.trim().toLowerCase();
    const row = {
      email,
      password_hash: params.password_hash,
      name: params.name,
      role: params.role,
      status: 'active' as const,
      created_by: params.created_by,
    };

    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_users')
        .insert(row)
        .select()
        .single();
      if (error) throw new ConflictException(error.message);
      return data as AdminUserRecord;
    }

    const admin: AdminUserRecord = {
      id: crypto.randomUUID(),
      ...row,
      mfa_enabled: false,
      last_login_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revoked_at: null,
      revoked_by: null,
    };
    this.memAdmins.set(email, admin);
    return admin;
  }

  async createSession(
    adminId: string,
    role: AdminRole,
    expiresAt: Date,
    ip?: string,
    userAgent?: string,
  ): Promise<AdminSessionRecord> {
    const row = {
      admin_id: adminId,
      role_at_issue: role,
      status: 'active' as const,
      ip_address: ip ?? null,
      user_agent: userAgent?.slice(0, 512) ?? null,
      expires_at: expiresAt.toISOString(),
    };

    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_sessions')
        .insert(row)
        .select()
        .single();
      if (error) throw new BadRequestException(error.message);
      return data as AdminSessionRecord;
    }

    const session: AdminSessionRecord = {
      id: crypto.randomUUID(),
      ...row,
      created_at: new Date().toISOString(),
      revoked_at: null,
      revoked_reason: null,
    };
    this.memSessions.set(session.id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<AdminSessionRecord | null> {
    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();
      if (error) return this.memSessions.get(sessionId) ?? null;
      return data as AdminSessionRecord | null;
    }
    return this.memSessions.get(sessionId) ?? null;
  }

  async touchLastLogin(adminId: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.supabase.isConfigured) {
      await this.client()
        .from('admin_users')
        .update({ last_login_at: now, updated_at: now })
        .eq('id', adminId);
      return;
    }
    const admin = [...this.memAdmins.values()].find((a) => a.id === adminId);
    if (admin) admin.last_login_at = now;
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.supabase.isConfigured) {
      await this.client()
        .from('admin_sessions')
        .update({ status: 'revoked', revoked_at: now, revoked_reason: reason })
        .eq('id', sessionId);
      return;
    }
    const s = this.memSessions.get(sessionId);
    if (s) {
      s.status = 'revoked';
      s.revoked_at = now;
      s.revoked_reason = reason;
    }
  }

  async revokeAllSessions(adminId: string, reason: string): Promise<number> {
    const now = new Date().toISOString();
    if (this.supabase.isConfigured) {
      const { data } = await this.client()
        .from('admin_sessions')
        .update({ status: 'revoked', revoked_at: now, revoked_reason: reason })
        .eq('admin_id', adminId)
        .eq('status', 'active')
        .select('id');
      return data?.length ?? 0;
    }
    let count = 0;
    for (const s of this.memSessions.values()) {
      if (s.admin_id === adminId && s.status === 'active') {
        s.status = 'revoked';
        s.revoked_at = now;
        s.revoked_reason = reason;
        count++;
      }
    }
    return count;
  }

  generateInviteToken(inviteId: string): string {
    const secret = process.env.ADMIN_INVITE_SECRET ?? process.env.JWT_SECRET ?? 'dev-invite-secret';
    const random = crypto.randomBytes(32).toString('hex');
    const payload = `${inviteId}.${random}`;
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${hmac}`;
  }

  verifyInviteToken(token: string): { inviteId: string } | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [inviteId, random, sig] = parts;
    const secret = process.env.ADMIN_INVITE_SECRET ?? process.env.JWT_SECRET ?? 'dev-invite-secret';
    const expected = crypto.createHmac('sha256', secret).update(`${inviteId}.${random}`).digest('hex');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) {
      return null;
    }
    return { inviteId };
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createInvite(params: {
    email: string;
    name: string;
    role: AdminRole;
    invitedBy: string;
    elevated?: boolean;
    reason?: string;
  }) {
    const email = params.email.trim().toLowerCase();
    if (params.role === 'super_admin' && !params.elevated) {
      throw new ForbiddenException('super_admin invites require elevated flag and reason');
    }
    if (params.role === 'super_admin' && !params.reason?.trim()) {
      throw new BadRequestException('Reason required for super_admin invite');
    }

    const existing = await this.findByEmail(email);
    if (existing) throw new ConflictException('Email already registered as admin');

    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
    const inviteId = crypto.randomUUID();
    const token = this.generateInviteToken(inviteId);
    const tokenHash = this.hashToken(token);

    const row = {
      id: inviteId,
      email,
      name: params.name,
      role: params.role,
      token_hash: tokenHash,
      status: 'pending' as const,
      expires_at: expiresAt.toISOString(),
      invited_by: params.invitedBy,
    };

    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_invites')
        .insert(row)
        .select()
        .single();
      if (error) throw new ConflictException(error.message);
      return { invite: data, token };
    }

    this.memInvites.set(inviteId, row);
    return { invite: row, token };
  }

  async listInvites(): Promise<unknown[]> {
    if (this.supabase.isConfigured) {
      const { data } = await this.client()
        .from('admin_invites')
        .select('id, email, name, role, status, expires_at, invited_by, accepted_at, created_at')
        .order('created_at', { ascending: false });
      return data ?? [];
    }
    return [...this.memInvites.values()];
  }

  async revokeInvite(inviteId: string): Promise<void> {
    if (this.supabase.isConfigured) {
      await this.client()
        .from('admin_invites')
        .update({ status: 'revoked' })
        .eq('id', inviteId)
        .eq('status', 'pending');
      return;
    }
    const inv = this.memInvites.get(inviteId);
    if (inv) inv.status = 'revoked';
  }

  async acceptInvite(token: string, password: string, name?: string): Promise<AdminUserRecord> {
    if (password.length < 12) {
      throw new BadRequestException('Password must be at least 12 characters');
    }

    const parsed = this.verifyInviteToken(token);
    if (!parsed) throw new BadRequestException('Invalid invite token');

    const tokenHash = this.hashToken(token);
    let invite: Record<string, unknown> | null = null;

    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_invites')
        .select('*')
        .eq('id', parsed.inviteId)
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (error || !data) throw new BadRequestException('Invite not found');
      invite = data;
    } else {
      invite = this.memInvites.get(parsed.inviteId) ?? null;
      if (invite && invite.token_hash !== tokenHash) invite = null;
    }

    if (!invite) throw new BadRequestException('Invite not found');
    if (invite.status !== 'pending') throw new ConflictException('Invite already used or revoked');
    if (new Date(String(invite.expires_at)) < new Date()) {
      throw new BadRequestException('Invite expired');
    }

    const role = String(invite.role);
    if (!isAdminRole(role)) throw new BadRequestException('Invalid invite role');

    const hash = await this.hashPassword(password);
    const admin = await this.insertAdmin({
      email: String(invite.email),
      password_hash: hash,
      name: name?.trim() || String(invite.name),
      role,
      created_by: String(invite.invited_by),
    });

    if (this.supabase.isConfigured) {
      await this.client()
        .from('admin_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', parsed.inviteId);
    } else {
      invite.status = 'accepted';
      invite.accepted_at = new Date().toISOString();
    }

    return admin;
  }

  async listAdmins(): Promise<Partial<AdminUserRecord>[]> {
    if (this.supabase.isConfigured) {
      const { data } = await this.client()
        .from('admin_users')
        .select('id, email, name, role, status, last_login_at, created_at, created_by')
        .order('created_at', { ascending: true });
      return data ?? [];
    }
    return [...this.memAdmins.values()].map(({ password_hash: _, ...rest }) => rest);
  }

  async changeRole(
    targetId: string,
    newRole: AdminRole,
    actorId: string,
    reason: string,
  ): Promise<{ admin: AdminUserRecord; sessionsRevoked: number }> {
    if (targetId === actorId) {
      throw new ForbiddenException('Cannot change own role');
    }
    if (!isAdminRole(newRole)) throw new BadRequestException('Invalid role');

    const target = await this.findById(targetId);
    if (!target) throw new NotFoundException('Admin not found');

    if (target.role === 'super_admin' && newRole !== 'super_admin') {
      const superCount = await this.countActiveSuperAdmins();
      if (superCount <= 1) {
        throw new ForbiddenException('Cannot demote the last super_admin');
      }
    }

    const now = new Date().toISOString();
    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_users')
        .update({ role: newRole, updated_at: now })
        .eq('id', targetId)
        .select()
        .single();
      if (error) throw new BadRequestException(error.message);
      const sessionsRevoked = await this.revokeAllSessions(targetId, `role_changed:${reason}`);
      return { admin: data as AdminUserRecord, sessionsRevoked };
    }

    target.role = newRole;
    target.updated_at = now;
    const sessionsRevoked = await this.revokeAllSessions(targetId, `role_changed:${reason}`);
    return { admin: target, sessionsRevoked };
  }

  async suspendAdmin(targetId: string, actorId: string, reason: string): Promise<AdminUserRecord> {
    if (targetId === actorId) throw new ForbiddenException('Cannot suspend self');
    return this.setStatus(targetId, 'suspended', reason);
  }

  async revokeAdmin(targetId: string, actorId: string, reason: string): Promise<AdminUserRecord> {
    if (targetId === actorId) throw new ForbiddenException('Cannot revoke self');
    const admin = await this.setStatus(targetId, 'revoked', reason);
    await this.revokeAllSessions(targetId, `admin_revoked:${reason}`);
    return admin;
  }

  private async setStatus(
    targetId: string,
    status: 'suspended' | 'revoked',
    reason: string,
  ): Promise<AdminUserRecord> {
    const target = await this.findById(targetId);
    if (!target) throw new NotFoundException('Admin not found');

    const now = new Date().toISOString();
    const patch =
      status === 'revoked'
        ? { status, updated_at: now, revoked_at: now }
        : { status, updated_at: now };

    if (this.supabase.isConfigured) {
      const { data, error } = await this.client()
        .from('admin_users')
        .update(patch)
        .eq('id', targetId)
        .select()
        .single();
      if (error) throw new BadRequestException(error.message);
      if (status === 'suspended') {
        await this.revokeAllSessions(targetId, `admin_suspended:${reason}`);
      }
      return data as AdminUserRecord;
    }

    Object.assign(target, patch);
    if (status === 'suspended') {
      await this.revokeAllSessions(targetId, `admin_suspended:${reason}`);
    }
    return target;
  }

  private async countActiveSuperAdmins(): Promise<number> {
    if (this.supabase.isConfigured) {
      const { count } = await this.client()
        .from('admin_users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('status', 'active');
      return count ?? 0;
    }
    return [...this.memAdmins.values()].filter(
      (a) => a.role === 'super_admin' && a.status === 'active',
    ).length;
  }
}
