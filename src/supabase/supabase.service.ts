import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getPlatformConfig } from '../startup/platform-config';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor() {
    const { supabase } = getPlatformConfig();
    this.client = createClient(supabase.url, supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  get isConfigured(): boolean {
    return true;
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
