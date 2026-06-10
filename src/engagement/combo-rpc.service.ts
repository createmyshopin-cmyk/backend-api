import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapEngagementRpcError } from './engagement-error.util';

export interface PremiumGiftItem {
  premiumGiftId: string;
  giftId: string;
  name: string;
  coinCost: number;
  iconUrl?: string;
  campaignKey: string;
  displayTier: string;
  badgeLabel: string;
  visualTheme: string;
}

@Injectable()
export class ComboRpcService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    return this.supabase.getClient();
  }

  async getPremiumGiftsCatalog(): Promise<{ items: PremiumGiftItem[] }> {
    const { data, error } = await this.client().rpc('get_premium_gifts_catalog');
    if (error) mapEngagementRpcError(error, 'get_premium_gifts_catalog');
    const row = data as Record<string, unknown>;
    const items = (row.items as Record<string, unknown>[]) ?? [];
    return {
      items: items.map((i) => ({
        premiumGiftId: String(i.premiumGiftId ?? i.premium_gift_id ?? ''),
        giftId: String(i.giftId ?? i.gift_id ?? ''),
        name: String(i.name ?? ''),
        coinCost: Number(i.coinCost ?? i.coin_cost ?? 0),
        iconUrl: i.iconUrl ? String(i.iconUrl) : undefined,
        campaignKey: String(i.campaignKey ?? i.campaign_key ?? ''),
        displayTier: String(i.displayTier ?? i.display_tier ?? 'premium'),
        badgeLabel: String(i.badgeLabel ?? i.badge_label ?? 'Premium'),
        visualTheme: String(i.visualTheme ?? i.visual_theme ?? 'gold'),
      })),
    };
  }

  async getComboStatus(userId: string) {
    const { data, error } = await this.client().rpc('get_combo_status', {
      p_user_id: userId,
    });
    if (error) mapEngagementRpcError(error, 'get_combo_status');
    return data as Record<string, unknown>;
  }

  async getComboHistory(userId: string, limit = 20) {
    const { data, error } = await this.client().rpc('get_combo_history', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) mapEngagementRpcError(error, 'get_combo_history');
    return data as Record<string, unknown>;
  }
}
