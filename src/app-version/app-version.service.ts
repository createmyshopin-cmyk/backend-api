import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FcmService } from '../fcm/fcm.service';
import { isVersionLessThan } from './version.util';
import type {
  CreateReleaseDto,
  NotificationTarget,
  ReleaseType,
  UpdateAppVersionSettingsDto,
} from './dto/app-version.dto';

export interface AppVersionSettingsRow {
  id: string;
  latest_version: string;
  minimum_supported_version: string;
  force_update: boolean;
  release_type: ReleaseType;
  title: string;
  message: string;
  play_store_url: string;
  app_store_url: string;
  maintenance_mode: boolean;
  maintenance_title: string;
  maintenance_message: string;
  maintenance_duration_minutes: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppReleaseRow {
  id: string;
  version: string;
  build_number: number;
  release_type: ReleaseType;
  title: string;
  message: string;
  changelog: string;
  play_store_url: string;
  app_store_url: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

const DEFAULT_SETTINGS: AppVersionSettingsRow = {
  id: 'default',
  latest_version: '1.0.0',
  minimum_supported_version: '1.0.0',
  force_update: false,
  release_type: 'optional',
  title: '🚀 New Version Available',
  message: "We've improved call quality and fixed bugs.",
  play_store_url:
    'https://play.google.com/store/apps/details?id=com.example.flutter_voice_calling_app_2026',
  app_store_url: 'https://apps.apple.com/app/creomine',
  maintenance_mode: false,
  maintenance_title: '🔧 Maintenance',
  maintenance_message: "We're improving Creomine. Please come back soon.",
  maintenance_duration_minutes: 30,
  updated_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

@Injectable()
export class AppVersionService {
  private readonly logger = new Logger(AppVersionService.name);
  private memSettings: AppVersionSettingsRow = { ...DEFAULT_SETTINGS };
  private memReleases: AppReleaseRow[] = [];
  private settingsCache: { value: AppVersionSettingsRow; expiresAt: number } | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly fcm: FcmService,
  ) {}

  async getPublicConfig(platform?: 'android' | 'ios') {
    const s = await this.getSettings();
    const storeUrl =
      platform === 'ios' ? s.app_store_url : s.play_store_url;
    return {
      latestVersion: s.latest_version,
      minimumSupportedVersion: s.minimum_supported_version,
      forceUpdate: s.force_update || s.release_type === 'force',
      title: s.title,
      message: s.message,
      playStoreUrl: s.play_store_url,
      appStoreUrl: s.app_store_url,
      storeUrl,
      releaseType: s.release_type,
      maintenanceMode: s.maintenance_mode || s.release_type === 'maintenance',
      maintenanceTitle: s.maintenance_title,
      maintenanceMessage: s.maintenance_message,
      maintenanceDurationMinutes: s.maintenance_duration_minutes,
    };
  }

  async getSettingsForAdmin() {
    const s = await this.getSettings();
    return this.mapSettings(s);
  }

  async updateSettings(dto: UpdateAppVersionSettingsDto, adminId: string) {
    const now = new Date().toISOString();
    const patch = {
      latest_version: dto.latestVersion,
      minimum_supported_version: dto.minimumSupportedVersion,
      force_update: dto.forceUpdate,
      release_type: dto.releaseType,
      title: dto.title,
      message: dto.message,
      play_store_url: dto.playStoreUrl,
      app_store_url: dto.appStoreUrl,
      maintenance_mode: dto.maintenanceMode ?? false,
      maintenance_title: dto.maintenanceTitle ?? DEFAULT_SETTINGS.maintenance_title,
      maintenance_message:
        dto.maintenanceMessage ?? DEFAULT_SETTINGS.maintenance_message,
      maintenance_duration_minutes:
        dto.maintenanceDurationMinutes ?? DEFAULT_SETTINGS.maintenance_duration_minutes,
      updated_by: adminId,
      updated_at: now,
    };

    if (!this.supabase.isConfigured) {
      this.memSettings = { ...this.memSettings, ...patch };
      this.invalidateCache();
      return this.mapSettings(this.memSettings);
    }

    const db = this.supabase.getClient();
    const existing = await this.fetchSettingsRow();
    if (!existing) {
      const { data, error } = await db
        .from('app_version_settings')
        .insert(patch)
        .select('*')
        .single();
      if (error) throw new BadRequestException(error.message);
      this.invalidateCache();
      return this.mapSettings(data as AppVersionSettingsRow);
    }

    const { data, error } = await db
      .from('app_version_settings')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    this.invalidateCache();
    return this.mapSettings(data as AppVersionSettingsRow);
  }

  async listReleases() {
    if (!this.supabase.isConfigured) {
      return this.memReleases.map((r) => this.mapRelease(r));
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('app_release_history')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data as AppReleaseRow[]).map((r) => this.mapRelease(r));
  }

  async getRelease(id: string) {
    if (!this.supabase.isConfigured) {
      const row = this.memReleases.find((r) => r.id === id);
      if (!row) throw new NotFoundException('Release not found');
      return this.mapRelease(row);
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('app_release_history')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Release not found');
    return this.mapRelease(data as AppReleaseRow);
  }

  async createRelease(dto: CreateReleaseDto, adminId: string) {
    const row = {
      version: dto.version,
      build_number: dto.buildNumber,
      release_type: dto.releaseType,
      title: dto.title,
      message: dto.message,
      changelog: dto.changelog,
      play_store_url: dto.playStoreUrl,
      app_store_url: dto.appStoreUrl,
      is_active: dto.isActive ?? false,
      created_by: adminId,
    };

    if (!this.supabase.isConfigured) {
      const created: AppReleaseRow = {
        id: `rel-${Date.now()}`,
        ...row,
        created_at: new Date().toISOString(),
      };
      if (created.is_active) {
        this.memReleases = this.memReleases.map((r) => ({ ...r, is_active: false }));
      }
      this.memReleases.unshift(created);
      if (dto.syncToSettings) {
        await this.syncReleaseToSettings(created, adminId);
      }
      return this.mapRelease(created);
    }

    const db = this.supabase.getClient();
    if (row.is_active) {
      await db
        .from('app_release_history')
        .update({ is_active: false })
        .eq('is_active', true);
    }

    const { data, error } = await db
      .from('app_release_history')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);

    if (dto.syncToSettings) {
      await this.syncReleaseToSettings(data as AppReleaseRow, adminId);
    }
    return this.mapRelease(data as AppReleaseRow);
  }

  async sendNotification(
    target: NotificationTarget,
    opts: { title?: string; body?: string; releaseId?: string },
  ) {
    let title = opts.title;
    let body = opts.body;
    if (opts.releaseId) {
      const release = await this.getRelease(opts.releaseId);
      title = title ?? `🚀 Creomine ${release.version} Available`;
      body = body ?? `${release.message}\n\nUpdate now.`;
    }
    const settings = await this.getSettings();
    title = title ?? `🚀 Creomine ${settings.latest_version} Available`;
    body = body ?? `${settings.message}\n\nUpdate now.`;

    const tokens = await this.resolveTargetTokens(target);
    const result = await this.fcm.sendAppUpdateNotification({
      tokens,
      title,
      body,
      latestVersion: settings.latest_version,
    });
    return {
      success: true,
      target,
      title,
      body,
      tokensTargeted: tokens.length,
      tokensSent: result.sent,
      tokensFailed: result.failed,
    };
  }

  async getAnalytics() {
    if (!this.supabase.isConfigured) {
      const s = await this.getSettings();
      return {
        totalReported: 0,
        onLatest: 0,
        outdated: 0,
        blocked: 0,
        adoptionPercent: 0,
        usersByVersion: [],
        latestVersion: s.latest_version,
        minimumSupportedVersion: s.minimum_supported_version,
      };
    }
    const { data, error } = await this.supabase
      .getClient()
      .rpc('get_app_version_analytics');
    if (error) throw new BadRequestException(error.message);
    const raw = data as Record<string, unknown>;
    return {
      totalReported: Number(raw.totalReported ?? 0),
      onLatest: Number(raw.onLatest ?? 0),
      outdated: Number(raw.outdated ?? 0),
      blocked: Number(raw.blocked ?? 0),
      adoptionPercent: Number(raw.adoptionPercent ?? 0),
      usersByVersion: (raw.usersByVersion as unknown[]) ?? [],
      latestVersion: String(raw.latestVersion ?? ''),
      minimumSupportedVersion: String(raw.minimumSupportedVersion ?? ''),
    };
  }

  async reportUserVersion(
    userId: string,
    version: string,
    buildNumber: number,
    platform: 'android' | 'ios',
  ) {
    if (!this.supabase.isConfigured) return { success: true };
    const { error } = await this.supabase.getClient().from('users').update({
      app_version: version,
      app_build_number: buildNumber,
      app_platform: platform,
      app_version_reported_at: new Date().toISOString(),
    }).eq('id', userId);
    if (error) this.logger.warn(`reportUserVersion: ${error.message}`);
    return { success: !error };
  }

  async assertVersionSupported(
    installedVersion: string | undefined,
    platform?: 'android' | 'ios',
  ): Promise<void> {
    const settings = await this.getSettings();
    if (settings.maintenance_mode || settings.release_type === 'maintenance') {
      return;
    }
    const version = (installedVersion ?? '0.0.0').trim();
    if (isVersionLessThan(version, settings.minimum_supported_version)) {
      const err = new BadRequestException({
        code: 'APP_UPDATE_REQUIRED',
        message: 'App update required',
        minimumSupportedVersion: settings.minimum_supported_version,
        storeUrl:
          platform === 'ios'
            ? settings.app_store_url
            : settings.play_store_url,
      });
      throw err;
    }
  }

  private async syncReleaseToSettings(release: AppReleaseRow, adminId: string) {
    await this.updateSettings(
      {
        latestVersion: release.version,
        minimumSupportedVersion: release.version,
        forceUpdate: release.release_type === 'force',
        releaseType: release.release_type,
        title: release.title,
        message: release.message,
        playStoreUrl: release.play_store_url,
        appStoreUrl: release.app_store_url,
        maintenanceMode: release.release_type === 'maintenance',
      },
      adminId,
    );
  }

  private async resolveTargetTokens(target: NotificationTarget): Promise<string[]> {
    if (!this.supabase.isConfigured) return [];

    const db = this.supabase.getClient();

    if (target === 'all') {
      const { data } = await db
        .from('users')
        .select('fcm_token')
        .not('fcm_token', 'is', null);
      return (data ?? [])
        .map((r: { fcm_token: string | null }) => r.fcm_token)
        .filter((t): t is string => !!t);
    }

    if (target === 'users') {
      const { data } = await db
        .from('users')
        .select('fcm_token')
        .eq('is_creator', false)
        .not('fcm_token', 'is', null);
      return (data ?? [])
        .map((r: { fcm_token: string | null }) => r.fcm_token)
        .filter((t): t is string => !!t);
    }

    if (target === 'creators') {
      const { data } = await db
        .from('users')
        .select('fcm_token')
        .eq('is_creator', true)
        .not('fcm_token', 'is', null);
      return (data ?? [])
        .map((r: { fcm_token: string | null }) => r.fcm_token)
        .filter((t): t is string => !!t);
    }

    const levelFilter =
      target === 'new_superhosts'
        ? (level: number) => level < 8
        : target === 'pro_superhosts'
          ? (level: number) => level >= 8 && level < 25
          : (level: number) => level >= 25;

    const { data: levels } = await db
      .from('creator_levels')
      .select('creator_profile_id, level');

    const profileIds = (levels ?? [])
      .filter((l: { level: number }) => levelFilter(l.level))
      .map((l: { creator_profile_id: string }) => l.creator_profile_id);

    if (profileIds.length === 0) return [];

    const { data: profiles } = await db
      .from('creator_profiles')
      .select('user_id')
      .in('id', profileIds);

    const userIds = (profiles ?? []).map((p: { user_id: string }) => p.user_id);
    if (userIds.length === 0) return [];

    const { data: users } = await db
      .from('users')
      .select('fcm_token')
      .in('id', userIds)
      .not('fcm_token', 'is', null);

    return (users ?? [])
      .map((r: { fcm_token: string | null }) => r.fcm_token)
      .filter((t): t is string => !!t);
  }

  private async getSettings(): Promise<AppVersionSettingsRow> {
    const now = Date.now();
    if (this.settingsCache && this.settingsCache.expiresAt > now) {
      return this.settingsCache.value;
    }
    const row = await this.fetchSettingsRow();
    const value = row ?? this.memSettings;
    this.settingsCache = { value, expiresAt: now + 30_000 };
    return value;
  }

  private invalidateCache() {
    this.settingsCache = null;
  }

  private async fetchSettingsRow(): Promise<AppVersionSettingsRow | null> {
    if (!this.supabase.isConfigured) return this.memSettings;
    const { data, error } = await this.supabase
      .getClient()
      .from('app_version_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) {
      this.logger.warn(`fetchSettingsRow: ${error.message}`);
      return this.memSettings;
    }
    return (data as AppVersionSettingsRow) ?? null;
  }

  private mapSettings(s: AppVersionSettingsRow) {
    return {
      id: s.id,
      latestVersion: s.latest_version,
      minimumSupportedVersion: s.minimum_supported_version,
      forceUpdate: s.force_update,
      releaseType: s.release_type,
      title: s.title,
      message: s.message,
      playStoreUrl: s.play_store_url,
      appStoreUrl: s.app_store_url,
      maintenanceMode: s.maintenance_mode,
      maintenanceTitle: s.maintenance_title,
      maintenanceMessage: s.maintenance_message,
      maintenanceDurationMinutes: s.maintenance_duration_minutes,
      updatedBy: s.updated_by,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  }

  private mapRelease(r: AppReleaseRow) {
    return {
      id: r.id,
      version: r.version,
      buildNumber: r.build_number,
      releaseType: r.release_type,
      title: r.title,
      message: r.message,
      changelog: r.changelog,
      playStoreUrl: r.play_store_url,
      appStoreUrl: r.app_store_url,
      isActive: r.is_active,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }
}
