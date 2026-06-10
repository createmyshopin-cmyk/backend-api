/** Six first-class admin roles — no legacy `admin` string. */
export const ADMIN_ROLES = [
  'super_admin',
  'finance_admin',
  'moderator',
  'support_admin',
  'fraud_admin',
  'operations_admin',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ALL_ADMIN_ROLES: AdminRole[] = [...ADMIN_ROLES];

export function isAdminRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
