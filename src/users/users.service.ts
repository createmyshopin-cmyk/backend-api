import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';

// ─── Domain model ───────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  coins: number;
  totalCalls: number;
  status: 'active' | 'blocked' | 'suspended';
  registeredAt: string;
  firebase_uid?: string;
  fullName?: string;
  dateOfBirth?: string;
  gender?: string;
  avatarUrl?: string;
  language?: string;
  onboardingCompleted?: boolean;
  isCreator?: boolean;
  fcm_token?: string;
}

const USER_SELECT =
  'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, full_name, date_of_birth, gender, avatar_url, language, onboarding_completed, is_creator, fcm_token';

// ─── Row → domain mapping ────────────────────────────────────────────────────

/** Canonical display name — always prefers `full_name` over legacy `name`. */
export function resolveDisplayName(
  row: { full_name?: string | null; name?: string | null },
  fallback = '',
): string {
  const full = String(row.full_name ?? '').trim();
  if (full) return full;
  const legacy = String(row.name ?? '').trim();
  if (legacy) return legacy;
  return fallback;
}

export interface PublicUserProfile {
  id: string;
  fullName: string;
  dateOfBirth?: string;
  gender?: string;
  avatarUrl?: string;
  onboardingCompleted: boolean;
  name: string;
  phone: string;
  email: string;
  coins: number;
  status: string;
  language?: string;
  isCreator: boolean;
  creatorStatus: string;
}

function resolveOnboardingCompleted(user: User): boolean {
  if (user.onboardingCompleted) return true;
  const fullName = resolveDisplayName(
    { full_name: user.fullName, name: user.name },
    '',
  );
  return (
    fullName.length >= 3 &&
    Boolean(user.dateOfBirth) &&
    (user.gender === 'male' || user.gender === 'female')
  );
}

export function toPublicProfile(user: User): PublicUserProfile {
  const fullName = resolveDisplayName(
    { full_name: user.fullName, name: user.name },
    '',
  );
  return {
    id: user.id,
    fullName,
    dateOfBirth: user.dateOfBirth,
    gender: user.gender,
    avatarUrl: user.avatarUrl,
    onboardingCompleted: resolveOnboardingCompleted(user),
    name: fullName,
    phone: user.phone,
    email: user.email,
    coins: user.coins,
    status: user.status,
    language: user.language,
    isCreator: Boolean(user.isCreator),
    creatorStatus: user.isCreator ? 'active' : 'none',
  };
}

function rowToUser(row: Record<string, unknown>): User {
  const displayName = resolveDisplayName({
    full_name: row.full_name as string | null,
    name: row.name as string | null,
  });
  const dateOfBirth = row.date_of_birth
    ? String(row.date_of_birth).slice(0, 10)
    : undefined;

  return {
    id: row.id as string,
    name: displayName,
    phone: (row.phone as string) || '',
    email: (row.email as string) || '',
    coins: Number(row.coins ?? 0),
    totalCalls: Number(row.total_calls ?? 0),
    status: (row.status === 'blocked' || row.status === 'suspended' ? row.status : 'active'),
    registeredAt: (row.created_at as string) || new Date().toISOString(),
    firebase_uid: (row.firebase_uid as string) || undefined,
    fullName: displayName || undefined,
    dateOfBirth,
    gender: (row.gender as string) || undefined,
    avatarUrl: (row.avatar_url as string) || undefined,
    language: (row.language as string) || undefined,
    onboardingCompleted: Boolean(row.onboarding_completed ?? false),
    isCreator: Boolean(row.is_creator ?? false),
    fcm_token: (row.fcm_token as string) || undefined,
  };
}

// ─── Fallback in-memory store (used when Supabase is not configured) ─────────

const SEED_USERS: User[] = [
  {
    id: 'USR001', name: 'Aarav Sharma', phone: '+91 98765 43210',
    email: 'aarav@gmail.com', coins: 450, totalCalls: 24,
    status: 'active', registeredAt: '2026-01-15T10:30:00Z',
  },
  {
    id: 'USR002', name: 'Rohan Mehta', phone: '+91 98123 45678',
    email: 'rohan@yahoo.com', coins: 15, totalCalls: 45,
    status: 'active', registeredAt: '2026-02-10T14:15:00Z',
  },
];

@Injectable()
export class UsersService {
  /** Mutable only when Supabase is unconfigured */
  private memUsers: User[] = JSON.parse(JSON.stringify(SEED_USERS));

  constructor(private readonly supabase: SupabaseService) {}

  // ─── Read ──────────────────────────────────────────────────────────────────

  async findAll(status?: 'active' | 'blocked'): Promise<User[]> {
    if (this.supabase.isConfigured) {
      try {
        let q = this.supabase.getClient().from('users').select(USER_SELECT);
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        if (!error && data) return (data as Record<string, unknown>[]).map(rowToUser);
        console.warn('UsersService.findAll Supabase error:', error?.message);
      } catch (e) {
        console.warn('UsersService.findAll exception:', (e as Error).message);
      }
    }
    return status ? this.memUsers.filter((u) => u.status === status) : [...this.memUsers];
  }

  async findOne(id: string): Promise<User> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('users')
          .select(USER_SELECT)
          .eq('id', id)
          .single();
        if (!error && data) return rowToUser(data as Record<string, unknown>);
        if (error?.code !== 'PGRST116') {
          // PGRST116 = no rows → fall through to 404
          console.warn('UsersService.findOne Supabase error:', error?.message);
        }
      } catch (e) {
        console.warn('UsersService.findOne exception:', (e as Error).message);
      }
    }
    const mem = this.memUsers.find((u) => u.id === id);
    if (!mem) throw new NotFoundException(`User ${id} not found`);
    return mem;
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('users')
          .select(
            USER_SELECT,
          )
          .eq('phone', phone)
          .maybeSingle();
        if (!error && data) return rowToUser(data as Record<string, unknown>);
        if (error) console.warn('UsersService.findByPhone Supabase error:', error.message);
      } catch (e) {
        console.warn('UsersService.findByPhone exception:', (e as Error).message);
      }
    }
    return this.memUsers.find((u) => u.phone === phone);
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('users')
          .select(
            USER_SELECT,
          )
          .eq('firebase_uid', firebaseUid)
          .maybeSingle();
        if (!error && data) return rowToUser(data as Record<string, unknown>);
        if (error) console.warn('UsersService.findByFirebaseUid Supabase error:', error.message);
      } catch (e) {
        console.warn('UsersService.findByFirebaseUid exception:', (e as Error).message);
      }
    }
    return this.memUsers.find((u) => u.firebase_uid === firebaseUid);
  }

  async syncFirebaseIdentity(
    id: string,
    data: { firebase_uid: string; phone: string },
  ): Promise<User> {
    if (this.supabase.isConfigured) {
      try {
        const { data: row, error } = await this.supabase
          .getClient()
          .from('users')
          .update({
            firebase_uid: data.firebase_uid,
            phone: data.phone,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .select(
            USER_SELECT,
          )
          .single();

        if (!error && row) return rowToUser(row as Record<string, unknown>);
        if (error) console.warn('UsersService.syncFirebaseIdentity Supabase error:', error.message);
      } catch (e) {
        console.warn('UsersService.syncFirebaseIdentity exception:', (e as Error).message);
      }
    }

    const mem = this.memUsers.find((u) => u.id === id);
    if (mem) {
      mem.firebase_uid = data.firebase_uid;
      mem.phone = data.phone;
      return mem;
    }
    return this.findOne(id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(data: {
    firebase_uid: string;
    phone: string;
    name: string;
  }): Promise<User> {
    if (this.supabase.isConfigured) {
      try {
        const { data: row, error } = await this.supabase
          .getClient()
          .from('users')
          .insert({
            firebase_uid: data.firebase_uid,
            phone: data.phone,
            name: data.name || '',
            full_name: data.name || '',
            coins: 100,
            status: 'active',
          })
          .select(
            USER_SELECT,
          )
          .single();

        if (error) {
          throw new InternalServerErrorException(`Failed to create user: ${error.message}`);
        }
        return rowToUser(row as Record<string, unknown>);
      } catch (e) {
        if (e instanceof InternalServerErrorException) throw e;
        console.warn('UsersService.create exception:', (e as Error).message);
      }
    }

    // In-memory fallback
    const newUser: User = {
      id: `USR${Date.now().toString().slice(-6)}`,
      name: data.name || '',
      phone: data.phone,
      email: '',
      coins: 100,
      totalCalls: 0,
      status: 'active',
      registeredAt: new Date().toISOString(),
      firebase_uid: data.firebase_uid,
    };
    this.memUsers.push(newUser);
    return newUser;
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async updateStatus(id: string, status: 'active' | 'blocked' | 'suspended') {
    if (this.supabase.isConfigured) {
      try {
        const { error } = await this.supabase
          .getClient()
          .from('users')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) console.warn('UsersService.updateStatus Supabase error:', error.message);
      } catch (e) {
        console.warn('UsersService.updateStatus exception:', (e as Error).message);
      }
    }
    const mem = this.memUsers.find((u) => u.id === id);
    if (mem) mem.status = status;
    const user = await this.findOne(id);
    return { message: `User status changed to ${status}`, user };
  }

  /**
   * Atomically adjusts a user's coin balance.
   * @param id   User UUID
   * @param delta Positive to add, negative to deduct
   */
  async updateCoins(id: string, delta: number): Promise<User> {
    if (this.supabase.isConfigured) {
      try {
        // Use RPC to do an atomic increment so concurrent calls don't race
        const { data, error } = await this.supabase
          .getClient()
          .rpc('adjust_user_coins', { p_user_id: id, p_delta: delta });

        if (!error) {
          // rpc returns the new balance
          const updated = await this.findOne(id);
          const mem = this.memUsers.find((u) => u.id === id);
          if (mem) mem.coins = updated.coins;
          return updated;
        }
        // RPC might not exist yet — fall back to read-modify-write
        console.warn('adjust_user_coins RPC failed, using read-modify-write:', error.message);
        const user = await this.findOne(id);
        const newCoins = Math.max(0, user.coins + delta);
        const { error: upErr } = await this.supabase
          .getClient()
          .from('users')
          .update({ coins: newCoins })
          .eq('id', id);
        if (upErr) console.warn('UsersService.updateCoins update error:', upErr.message);
        user.coins = newCoins;
        const mem = this.memUsers.find((u) => u.id === id);
        if (mem) mem.coins = newCoins;
        return user;
      } catch (e) {
        console.warn('UsersService.updateCoins exception:', (e as Error).message);
      }
    }

    // In-memory fallback
    const mem = this.memUsers.find((u) => u.id === id);
    if (!mem) throw new NotFoundException(`User ${id} not found`);
    mem.coins = Math.max(0, mem.coins + delta);
    return mem;
  }

  async saveFcmToken(userId: string, fcmToken: string): Promise<{ message: string }> {
    if (this.supabase.isConfigured) {
      try {
        const { error } = await this.supabase
          .getClient()
          .from('users')
          .update({ fcm_token: fcmToken, updated_at: new Date().toISOString() })
          .eq('id', userId);
        if (error) console.warn('UsersService.saveFcmToken Supabase error:', error.message);
      } catch (e) {
        console.warn('UsersService.saveFcmToken exception:', (e as Error).message);
      }
    }
    // Update in-memory store for dev fallback
    const mem = this.memUsers.find((u) => u.id === userId);
    if (mem) (mem as User & { fcm_token?: string }).fcm_token = fcmToken;
    return { message: 'FCM token saved' };
  }

  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    const existing = await this.findOne(userId);

    if (existing.onboardingCompleted) {
      throw new BadRequestException('Onboarding already completed');
    }

    if (existing.gender) {
      throw new BadRequestException('Gender has already been set');
    }

    if (existing.dateOfBirth) {
      throw new BadRequestException('Date of birth has already been set');
    }

    const trimmedName = dto.fullName.trim();
    const payload: Record<string, string | boolean> = {
      full_name: trimmedName,
      name: trimmedName,
      date_of_birth: dto.dateOfBirth,
      gender: dto.gender,
      avatar_url: dto.avatarUrl,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    };

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('users')
          .update(payload)
          .eq('id', userId)
          .select(USER_SELECT)
          .single();

        if (!error && data) {
          const user = rowToUser(data as Record<string, unknown>);
          this.syncMemUser(userId, user);
          return { message: 'Onboarding completed', user: toPublicProfile(user) };
        }
        if (error) {
          console.warn('UsersService.completeOnboarding Supabase error:', error.message);
          throw new BadRequestException(error.message);
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        console.warn('UsersService.completeOnboarding exception:', (e as Error).message);
      }
    }

    const mem = await this.findOne(userId);
    mem.fullName = trimmedName;
    mem.name = trimmedName;
    mem.dateOfBirth = dto.dateOfBirth;
    mem.gender = dto.gender;
    mem.avatarUrl = dto.avatarUrl;
    mem.onboardingCompleted = true;
    return { message: 'Onboarding completed', user: toPublicProfile(mem) };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.gender !== undefined) {
      throw new BadRequestException('Gender cannot be changed');
    }

    if (dto.dateOfBirth !== undefined) {
      throw new BadRequestException('Date of birth cannot be changed');
    }

    if (dto.onboardingCompleted !== undefined) {
      throw new BadRequestException(
        'Onboarding status cannot be changed via profile update',
      );
    }

    const payload: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.fullName !== undefined) {
      const trimmed = dto.fullName.trim();
      payload.full_name = trimmed;
      payload.name = trimmed;
    }
    if (dto.avatarUrl !== undefined) {
      payload.avatar_url = dto.avatarUrl;
    }
    if (dto.language !== undefined) {
      payload.language = dto.language;
    }

    if (dto.fullName === undefined && dto.avatarUrl === undefined && dto.language === undefined) {
      throw new BadRequestException('No profile fields to update');
    }

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('users')
          .update(payload)
          .eq('id', userId)
          .select(USER_SELECT)
          .single();

        if (!error && data) {
          const user = rowToUser(data as Record<string, unknown>);
          this.syncMemUser(userId, user);
          return { message: 'Profile updated', user: toPublicProfile(user) };
        }
        if (error) console.warn('UsersService.updateProfile Supabase error:', error.message);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        console.warn('UsersService.updateProfile exception:', (e as Error).message);
      }
    }

    const mem = await this.findOne(userId);
    if (dto.fullName !== undefined) {
      const trimmed = dto.fullName.trim();
      mem.fullName = trimmed;
      mem.name = trimmed;
    }
    if (dto.avatarUrl !== undefined) mem.avatarUrl = dto.avatarUrl;
    if (dto.language !== undefined) mem.language = dto.language;
    return { message: 'Profile updated', user: toPublicProfile(mem) };
  }

  private syncMemUser(userId: string, user: User): void {
    const mem = this.memUsers.find((u) => u.id === userId);
    if (mem) Object.assign(mem, user);
  }

  getMemUsers(): User[] {
    return this.memUsers;
  }
}
