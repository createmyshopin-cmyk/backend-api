import { CREATOR_ONLINE_THRESHOLD_SECONDS } from '../../creators/creators.service';

export function calculateAge(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function formatAgeLabel(age: number | null): string | null {
  if (age === null) return null;
  return `${age} Years`;
}

export function computeUserOnlineStatus(
  isCreator: boolean,
  creatorProfile?: {
    last_seen_at?: string | null;
    is_online?: boolean | null;
    online_status?: boolean | null;
  } | null,
): 'online' | 'offline' {
  if (!isCreator) return 'offline';
  const lastSeenAt = creatorProfile?.last_seen_at;
  if (lastSeenAt) {
    const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
    if (elapsedMs < CREATOR_ONLINE_THRESHOLD_SECONDS * 1000) return 'online';
  }
  const fallback = Boolean(
    creatorProfile?.is_online ?? creatorProfile?.online_status,
  );
  return fallback ? 'online' : 'offline';
}

export function normalizeGender(gender?: string | null): string | null {
  if (!gender?.trim()) return null;
  const g = gender.trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'Male';
  if (g === 'female' || g === 'f') return 'Female';
  return gender.trim();
}

export function genderMatchesFilter(
  userGender: string | null | undefined,
  filter: 'all' | 'male' | 'female',
): boolean {
  if (filter === 'all') return true;
  const g = (userGender || '').toLowerCase();
  if (filter === 'male') return g === 'male' || g === 'm';
  if (filter === 'female') return g === 'female' || g === 'f';
  return true;
}

export function transactionTypeLabel(type: string): string {
  switch (type) {
    case 'call_deduction':
      return 'DEBIT';
    case 'recharge':
      return 'CREDIT';
    case 'admin_adjustment_add':
      return 'CREDIT';
    case 'admin_adjustment_deduct':
      return 'DEBIT';
    case 'refund':
      return 'CREDIT';
    default:
      return type.toUpperCase();
  }
}

export function transactionDescription(
  type: string,
  description?: string | null,
): string {
  if (description?.trim()) return description.trim();
  switch (type) {
    case 'call_deduction':
      return 'Call Deduction';
    case 'recharge':
      return 'Coin Recharge';
    case 'admin_adjustment_add':
      return 'Admin Credit';
    case 'admin_adjustment_deduct':
      return 'Admin Deduction';
    case 'refund':
      return 'Refund';
    default:
      return type.replace(/_/g, ' ');
  }
}
