import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { resolveDisplayName, UsersService, User } from '../../users/users.service';
import { CoinTransactionsService } from '../../calls/coin-transactions.service';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import {
  calculateAge,
  computeUserOnlineStatus,
  formatAgeLabel,
  genderMatchesFilter,
  normalizeGender,
  transactionDescription,
  transactionTypeLabel,
} from './admin-users.utils';

const ADMIN_USER_SELECT = `
  id,
  name,
  full_name,
  phone,
  email,
  coins,
  total_calls,
  status,
  created_at,
  updated_at,
  firebase_uid,
  date_of_birth,
  gender,
  avatar_url,
  profile_image,
  language,
  onboarding_completed,
  is_creator,
  is_verified,
  creator_profiles (
    last_seen_at,
    is_online,
    online_status
  )
`;

interface CreatorProfileJoin {
  last_seen_at?: string | null;
  is_online?: boolean | null;
  online_status?: boolean | null;
}

interface UserRow extends Record<string, unknown> {
  creator_profiles?: CreatorProfileJoin | CreatorProfileJoin[] | null;
}

export interface AdminUserListItem {
  id: string;
  avatarUrl: string | null;
  fullName: string;
  gender: string | null;
  age: number | null;
  ageLabel: string | null;
  phone: string;
  walletBalance: number;
  totalCalls: number;
  totalMinutes: number;
  onlineStatus: 'online' | 'offline';
  onboardingCompleted: boolean;
  accountStatus: 'active' | 'blocked' | 'suspended';
  createdAt: string;
  isCreator: boolean;
}

export interface AdminUserDetailResponse {
  id: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  age: number | null;
  ageLabel: string | null;
  avatarUrl: string | null;
  phone: string;
  email: string | null;
  firebaseUid: string | null;
  language: string | null;
  walletBalance: number;
  onboardingCompleted: boolean;
  onlineStatus: 'online' | 'offline';
  isCreator: boolean;
  creatorStatus: 'none' | 'active';
  isVerified: boolean;
  blocked: boolean;
  status: 'active' | 'blocked' | 'suspended';
  accountCreatedAt: string;
  updatedAt: string | null;
  totalCalls: number;
  totalMinutes: number;
  totalCoinsSpent: number;
  callStatistics: {
    totalCalls: number;
    completedCalls: number;
    rejectedCalls: number;
    totalMinutes: number;
    totalCoinsSpent: number;
    averageCallDurationSeconds: number;
    averageCallDurationLabel: string;
  };
  recentTransactions: {
    id: string;
    date: string;
    type: string;
    coins: number;
    description: string;
  }[];
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly usersService: UsersService,
    private readonly coinTransactions: CoinTransactionsService,
  ) {}

  async listUsers(dto: ListAdminUsersDto): Promise<{ users: AdminUserListItem[]; total: number }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const sortBy = dto.sortBy ?? 'createdAt';
    const sortOrder = dto.sortOrder ?? 'desc';
    const search = dto.search?.trim() ?? '';
    const genderFilter = dto.gender ?? 'all';
    const statusFilter = dto.status ?? 'all';
    const onboardingFilter = dto.onboarding ?? 'all';
    const isCreatorFilter = dto.isCreator ?? 'all';

    if (this.supabase.isConfigured) {
      try {
        const result = await this.listFromSupabase({
          page,
          limit,
          sortBy,
          sortOrder,
          search,
          genderFilter,
          statusFilter,
          onboardingFilter,
          isCreatorFilter,
        });
        if (result) return result;
      } catch (e) {
        console.warn('AdminUsersService.listFromSupabase:', (e as Error).message);
      }
    }

    return this.listFromMemory({
      page,
      limit,
      sortBy,
      sortOrder,
      search,
      genderFilter,
      statusFilter,
      onboardingFilter,
      isCreatorFilter,
    });
  }

  async getUserDetail(id: string): Promise<AdminUserDetailResponse> {
    if (this.supabase.isConfigured) {
      try {
        const detail = await this.getDetailFromSupabase(id);
        if (detail) return detail;
      } catch (e) {
        if (e instanceof NotFoundException) throw e;
        console.warn('AdminUsersService.getDetailFromSupabase:', (e as Error).message);
      }
    }

    return this.getDetailFromMemory(id);
  }

  async updateUserStatus(id: string, status: 'active' | 'blocked' | 'suspended'): Promise<AdminUserDetailResponse> {
    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { error } = await client
          .from('users')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) {
          throw new Error(`Failed to update status in database: ${error.message}`);
        }
      } catch (e) {
        console.warn('AdminUsersService.updateUserStatus Supabase error:', (e as Error).message);
        throw e;
      }
    }

    const memUsers = this.usersService.getMemUsers();
    const mem = memUsers.find((u) => u.id === id);
    if (mem) {
      mem.status = status;
    }

    return this.getUserDetail(id);
  }

  private async listFromSupabase(params: {
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: string;
    search: string;
    genderFilter: string;
    statusFilter: string;
    onboardingFilter: string;
    isCreatorFilter: string;
  }): Promise<{ users: AdminUserListItem[]; total: number } | null> {
    const client = this.supabase.getClient();
    const sortColumn = this.sortColumn(params.sortBy);
    const ascending = params.sortOrder === 'asc';

    let q = client.from('users').select(ADMIN_USER_SELECT, { count: 'exact' });

    if (params.genderFilter !== 'all') {
      const g =
        params.genderFilter === 'male'
          ? 'Male'
          : 'Female';
      q = q.ilike('gender', g);
    }

    if (params.onboardingFilter === 'completed') {
      q = q.eq('onboarding_completed', true);
    } else if (params.onboardingFilter === 'not_completed') {
      q = q.eq('onboarding_completed', false);
    }

    if (params.isCreatorFilter === 'listener') {
      q = q.eq('is_creator', true);
    } else if (params.isCreatorFilter === 'non_listener') {
      q = q.eq('is_creator', false);
    }

    if (params.search) {
      const term = params.search.replace(/%/g, '');
      const uuidLike =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
      if (uuidLike) {
        q = q.eq('id', term);
      } else {
        q = q.or(
          `full_name.ilike.%${term}%,name.ilike.%${term}%,phone.ilike.%${term}%`,
        );
      }
    }

    q = q.order(sortColumn, { ascending, nullsFirst: false });

    const needsPresenceFilter = params.statusFilter !== 'all';
    if (needsPresenceFilter) {
      const { data, error } = await q;
      if (error) {
        console.warn('AdminUsersService list query error:', error.message);
        return null;
      }
      const mapped = (data as UserRow[]).map((row) => this.mapListItem(row));
      const filtered = mapped.filter((u) =>
        params.statusFilter === 'online'
          ? u.onlineStatus === 'online'
          : u.onlineStatus === 'offline',
      );
      const total = filtered.length;
      const start = (params.page - 1) * params.limit;
      return {
        users: filtered.slice(start, start + params.limit),
        total,
      };
    }

    const from = (params.page - 1) * params.limit;
    const to = from + params.limit - 1;
    const { data, error, count } = await q.range(from, to);
    if (error) {
      console.warn('AdminUsersService list range error:', error.message);
      return null;
    }

    return {
      users: (data as UserRow[]).map((row) => this.mapListItem(row)),
      total: count ?? 0,
    };
  }

  private async getDetailFromSupabase(id: string): Promise<AdminUserDetailResponse | null> {
    const client = this.supabase.getClient();

    const { data: row, error } = await client
      .from('users')
      .select(ADMIN_USER_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.warn('AdminUsersService detail error:', error.message);
      return null;
    }
    if (!row) throw new NotFoundException(`User ${id} not found`);

    const callStats = await this.aggregateCallStats(id);
    const totalMinutes = callStats.totalMinutes;
    const transactions = await this.coinTransactions.listByUserId(id, 15);

    const userRow = row as UserRow;
    const profile = this.pickCreatorProfile(userRow);
    const isCreator = Boolean(userRow.is_creator);
    const dateOfBirth = userRow.date_of_birth
      ? String(userRow.date_of_birth).slice(0, 10)
      : null;
    const age = calculateAge(dateOfBirth);
    const fullName = resolveDisplayName(
      {
        full_name: userRow.full_name as string | null,
        name: userRow.name as string | null,
      },
      'Unknown User',
    );

    return {
      id: userRow.id as string,
      fullName,
      gender: normalizeGender(userRow.gender as string),
      dateOfBirth,
      age,
      ageLabel: formatAgeLabel(age),
      avatarUrl: this.resolveAvatar(userRow),
      phone: (userRow.phone as string) || '',
      email: (userRow.email as string) || null,
      firebaseUid: (userRow.firebase_uid as string) || null,
      language: (userRow.language as string) || null,
      walletBalance: Number(userRow.coins ?? 0),
      onboardingCompleted: Boolean(userRow.onboarding_completed ?? false),
      onlineStatus: computeUserOnlineStatus(isCreator, profile),
      isCreator,
      creatorStatus: isCreator ? 'active' : 'none',
      isVerified: Boolean(userRow.is_verified ?? false),
      blocked: (userRow.status as string) === 'blocked',
      status: (userRow.status as 'active' | 'blocked' | 'suspended') || 'active',
      accountCreatedAt: (userRow.created_at as string) || new Date().toISOString(),
      updatedAt: (userRow.updated_at as string) || null,
      totalCalls: Number(userRow.total_calls ?? callStats.totalCalls),
      totalMinutes,
      totalCoinsSpent: callStats.totalCoinsSpent,
      callStatistics: callStats,
      recentTransactions: transactions.map((t) => ({
        id: t.id,
        date: t.createdAt.slice(0, 10),
        type: transactionTypeLabel(t.type),
        coins: t.amount,
        description: transactionDescription(t.type, t.description),
      })),
    };
  }

  private async aggregateCallStats(userId: string) {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('calls')
      .select('status, duration_seconds, coins_spent, coins_deducted')
      .eq('caller_id', userId);

    if (error) {
      console.warn('AdminUsersService call stats:', error.message);
      return this.emptyCallStats();
    }

    return this.buildCallStats(data ?? []);
  }

  private buildCallStats(
    rows: { status?: string; duration_seconds?: number; coins_spent?: number; coins_deducted?: number }[],
  ) {
    let completedCalls = 0;
    let rejectedCalls = 0;
    let totalDurationSeconds = 0;
    let totalCoinsSpent = 0;

    for (const row of rows) {
      const status = (row.status || '').toLowerCase();
      if (status === 'completed') completedCalls += 1;
      if (status === 'rejected') rejectedCalls += 1;
      totalDurationSeconds += Number(row.duration_seconds ?? 0);
      totalCoinsSpent += Number(row.coins_spent ?? row.coins_deducted ?? 0);
    }

    const totalCalls = rows.length;
    const totalMinutes = Math.round((totalDurationSeconds / 60) * 10) / 10;
    const averageCallDurationSeconds =
      completedCalls > 0 ? Math.round(totalDurationSeconds / completedCalls) : 0;

    return {
      totalCalls,
      completedCalls,
      rejectedCalls,
      totalMinutes,
      totalCoinsSpent,
      averageCallDurationSeconds,
      averageCallDurationLabel: this.formatDuration(averageCallDurationSeconds),
    };
  }

  private emptyCallStats() {
    return {
      totalCalls: 0,
      completedCalls: 0,
      rejectedCalls: 0,
      totalMinutes: 0,
      totalCoinsSpent: 0,
      averageCallDurationSeconds: 0,
      averageCallDurationLabel: '0m 0s',
    };
  }

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  private mapListItem(row: UserRow): AdminUserListItem {
    const profile = this.pickCreatorProfile(row);
    const isCreator = Boolean(row.is_creator);
    const dateOfBirth = row.date_of_birth
      ? String(row.date_of_birth).slice(0, 10)
      : null;
    const age = calculateAge(dateOfBirth);
    const fullName = resolveDisplayName(
      {
        full_name: row.full_name as string | null,
        name: row.name as string | null,
      },
      'Unknown User',
    );

    return {
      id: row.id as string,
      avatarUrl: this.resolveAvatar(row),
      fullName,
      gender: normalizeGender(row.gender as string),
      age,
      ageLabel: formatAgeLabel(age),
      phone: (row.phone as string) || '—',
      walletBalance: Number(row.coins ?? 0),
      totalCalls: Number(row.total_calls ?? 0),
      totalMinutes: 0,
      onlineStatus: computeUserOnlineStatus(isCreator, profile),
      onboardingCompleted: Boolean(row.onboarding_completed ?? false),
      accountStatus:
        row.status === 'blocked' || row.status === 'suspended' ? row.status : 'active',
      createdAt: (row.created_at as string) || new Date().toISOString(),
      isCreator,
    };
  }

  private pickCreatorProfile(row: UserRow): CreatorProfileJoin | null {
    const cp = row.creator_profiles;
    if (!cp) return null;
    return Array.isArray(cp) ? cp[0] ?? null : cp;
  }

  private resolveAvatar(row: UserRow): string | null {
    return (
      (row.avatar_url as string) ||
      (row.profile_image as string) ||
      null
    );
  }

  private sortColumn(sortBy: string): string {
    switch (sortBy) {
      case 'fullName':
        return 'full_name';
      case 'coins':
        return 'coins';
      case 'totalCalls':
        return 'total_calls';
      default:
        return 'created_at';
    }
  }

  private listFromMemory(params: {
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: string;
    search: string;
    genderFilter: string;
    statusFilter: string;
    onboardingFilter: string;
    isCreatorFilter: string;
  }): { users: AdminUserListItem[]; total: number } {
    const enriched = this.usersService.getMemUsers().map((u) =>
      this.mapMemoryListItem(u),
    );

    let filtered = enriched.filter((u) => {
      const term = params.search.toLowerCase();
      const matchSearch =
        !term ||
        u.fullName.toLowerCase().includes(term) ||
        u.phone.toLowerCase().includes(term) ||
        u.id.toLowerCase().includes(term);

      const matchGender = genderMatchesFilter(u.gender ?? undefined, params.genderFilter as 'all' | 'male' | 'female');
      const matchOnboarding =
        params.onboardingFilter === 'all' ||
        (params.onboardingFilter === 'completed' && u.onboardingCompleted) ||
        (params.onboardingFilter === 'not_completed' && !u.onboardingCompleted);
      const matchStatus =
        params.statusFilter === 'all' ||
        (params.statusFilter === 'online' && u.onlineStatus === 'online') ||
        (params.statusFilter === 'offline' && u.onlineStatus === 'offline');
      const matchIsCreator =
        params.isCreatorFilter === 'all' ||
        (params.isCreatorFilter === 'listener' && u.isCreator) ||
        (params.isCreatorFilter === 'non_listener' && !u.isCreator);

      return matchSearch && matchGender && matchOnboarding && matchStatus && matchIsCreator;
    });

    filtered = filtered.sort((a, b) => this.compareListItems(a, b, params.sortBy, params.sortOrder));

    const total = filtered.length;
    const start = (params.page - 1) * params.limit;
    return {
      users: filtered.slice(start, start + params.limit),
      total,
    };
  }

  private mapMemoryListItem(u: User): AdminUserListItem {
    const age = calculateAge(u.dateOfBirth);
    const isCreator = Boolean(u.isCreator);
    return {
      id: u.id,
      avatarUrl: u.avatarUrl ?? null,
      fullName: resolveDisplayName(
        { full_name: u.fullName, name: u.name },
        'Unknown User',
      ),
      gender: normalizeGender(u.gender),
      age,
      ageLabel: formatAgeLabel(age),
      phone: u.phone || '—',
      walletBalance: u.coins,
      totalCalls: u.totalCalls,
      totalMinutes: 0,
      onlineStatus: 'offline',
      onboardingCompleted: Boolean(u.onboardingCompleted),
      accountStatus: u.status === 'blocked' || u.status === 'suspended' ? u.status : 'active',
      createdAt: u.registeredAt,
      isCreator,
    };
  }

  private compareListItems(
    a: AdminUserListItem,
    b: AdminUserListItem,
    sortBy: string,
    sortOrder: string,
  ): number {
    const dir = sortOrder === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'fullName':
        return a.fullName.localeCompare(b.fullName) * dir;
      case 'coins':
        return (a.walletBalance - b.walletBalance) * dir;
      case 'totalCalls':
        return (a.totalCalls - b.totalCalls) * dir;
      default:
        return (
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
          dir
        );
    }
  }

  private async getDetailFromMemory(id: string): Promise<AdminUserDetailResponse> {
    const u = await this.usersService.findOne(id);
    const age = calculateAge(u.dateOfBirth);
    const callStats = this.emptyCallStats();
    callStats.totalCalls = u.totalCalls;

    const isCreator = Boolean(u.isCreator);
    return {
      id: u.id,
      fullName: resolveDisplayName(
        { full_name: u.fullName, name: u.name },
        'Unknown User',
      ),
      gender: normalizeGender(u.gender),
      dateOfBirth: u.dateOfBirth ?? null,
      age,
      ageLabel: formatAgeLabel(age),
      avatarUrl: u.avatarUrl ?? null,
      phone: u.phone,
      email: u.email || null,
      firebaseUid: u.firebase_uid ?? null,
      language: u.language ?? null,
      walletBalance: u.coins,
      onboardingCompleted: Boolean(u.onboardingCompleted),
      onlineStatus: 'offline',
      isCreator,
      creatorStatus: isCreator ? 'active' : 'none',
      isVerified: false,
      blocked: u.status === 'blocked',
      status: u.status,
      accountCreatedAt: u.registeredAt,
      updatedAt: null,
      totalCalls: u.totalCalls,
      totalMinutes: 0,
      totalCoinsSpent: 0,
      callStatistics: callStats,
      recentTransactions: [],
    };
  }
}
