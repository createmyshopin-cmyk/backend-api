import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient | null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.client = url && key ? createClient(url, key) : null;
    if (!this.client) {
      console.warn(
        'Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Creators API uses in-memory fallback.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase client is not configured');
    }
    return this.client;
  }
}
