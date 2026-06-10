import type { AdminRole } from './admin-roles';

export type AdminStatus = 'active' | 'suspended' | 'revoked';

export interface AdminUserRecord {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: AdminRole;
  status: AdminStatus;
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface AdminSessionRecord {
  id: string;
  admin_id: string;
  status: 'active' | 'revoked' | 'expired';
  role_at_issue: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

/** Attached to request.user after JwtAuthGuard for admin tokens. */
export interface AdminRequestUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: AdminStatus;
  sessionId: string;
  type: 'admin';
}
