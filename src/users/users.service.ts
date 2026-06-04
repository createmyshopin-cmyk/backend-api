import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

// ─── Domain model ───────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  coins: number;
  totalCalls: number;
  status: 'active' | 'blocked';
  registeredAt: string;
  firebase_uid?: string;
  gender?: string;
  language?: string;
  onboardingCompleted?: boolean;
  fcm_token?: string;
}

// ─── Row → domain mapping ────────────────────────────────────────────────────

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    name: (row.name as string) || '',
    phone: (row.phone as string) || '',
    email: (row.email as string) || '',
    coins: Number(row.coins ?? 0),
    totalCalls: Number(row.total_calls ?? 0),
    status: ((row.status as string) === 'blocked' ? 'blocked' : 'active'),
    registeredAt: (row.created_at as string) || new Date().toISOString(),
    firebase_uid: (row.firebase_uid as string) || undefined,
    gender: (row.gender as string) || undefined,
    language: (row.language as string) || undefined,
    onboardingCompleted: Boolean(row.onboarding_completed ?? false),
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
        let q = this.supabase.getClient().from('users').select(
          'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, gender, language, onboarding_completed, fcm_token',
        );
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
          .select(
            'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, gender, language, onboarding_completed, fcm_token',
          )
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
            'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, gender, language, onboarding_completed, fcm_token',
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
            'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, gender, language, onboarding_completed, fcm_token',
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
            'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, gender, language, onboarding_completed, fcm_token',
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
            coins: 100,
            status: 'active',
          })
          .select(
            'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, gender, language, onboarding_completed, fcm_token',
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

  async updateStatus(id: string, status: 'active' | 'blocked') {
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

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const payload: Record<string, string | boolean> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.gender !== undefined) payload.gender = dto.gender;
    if (dto.language !== undefined) payload.language = dto.language;
    if (dto.onboardingCompleted !== undefined) {
      payload.onboarding_completed = dto.onboardingCompleted;
    }

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('users')
          .update(payload)
          .eq('id', userId)
          .select(
            'id, name, phone, email, coins, total_calls, status, created_at, firebase_uid, gender, language, onboarding_completed, fcm_token',
          )
          .single();

        if (!error && data) {
          const user = rowToUser(data as Record<string, unknown>);
          const mem = this.memUsers.find((u) => u.id === userId);
          if (mem) {
            if (dto.gender !== undefined) mem.gender = dto.gender;
            if (dto.language !== undefined) mem.language = dto.language;
            if (dto.onboardingCompleted !== undefined) mem.onboardingCompleted = dto.onboardingCompleted;
          }
          return { message: 'Profile updated', user };
        }
        if (error) console.warn('UsersService.updateProfile Supabase error:', error.message);
      } catch (e) {
        console.warn('UsersService.updateProfile exception:', (e as Error).message);
      }
    }

    // In-memory fallback
    const mem = await this.findOne(userId);
    if (dto.gender !== undefined) mem.gender = dto.gender;
    if (dto.language !== undefined) mem.language = dto.language;
    if (dto.onboardingCompleted !== undefined) mem.onboardingCompleted = dto.onboardingCompleted;
    return { message: 'Profile updated', user: mem };
  }

  getMemUsers(): User[] {
    return this.memUsers;
  }
}
