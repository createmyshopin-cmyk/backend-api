import { BadRequestException } from '@nestjs/common';
import { AppVersionService } from './app-version.service';

describe('AppVersionService', () => {
  const fcm = { sendAppUpdateNotification: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }) };
  const supabase = { isConfigured: false, getClient: jest.fn() };

  let service: AppVersionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppVersionService(supabase as never, fcm as never);
  });

  it('returns public config with maintenance fields', async () => {
    const config = await service.getPublicConfig('android');
    expect(config.latestVersion).toBe('1.0.0');
    expect(config.maintenanceMode).toBe(false);
    expect(config.storeUrl).toContain('play.google.com');
  });

  it('updates in-memory settings when supabase unavailable', async () => {
    const result = await service.updateSettings(
      {
        latestVersion: '2.3.0',
        minimumSupportedVersion: '2.2.5',
        forceUpdate: true,
        releaseType: 'force',
        title: 'Update',
        message: 'Please update',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=test',
        appStoreUrl: 'https://apps.apple.com/app/test',
      },
      'admin-1',
    );
    expect(result.latestVersion).toBe('2.3.0');
    expect(result.forceUpdate).toBe(true);
  });

  it('creates append-only release history', async () => {
    const release = await service.createRelease(
      {
        version: '2.3.0',
        buildNumber: 32,
        releaseType: 'optional',
        title: 'New',
        message: 'Features',
        changelog: '- Fix bugs',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=test',
        appStoreUrl: 'https://apps.apple.com/app/test',
        isActive: true,
      },
      'admin-1',
    );
    expect(release.version).toBe('2.3.0');
    expect(release.buildNumber).toBe(32);
    const list = await service.listReleases();
    expect(list).toHaveLength(1);
  });

  it('throws APP_UPDATE_REQUIRED for outdated version', async () => {
    await service.updateSettings(
      {
        latestVersion: '2.3.0',
        minimumSupportedVersion: '2.2.5',
        forceUpdate: false,
        releaseType: 'optional',
        title: 't',
        message: 'm',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=test',
        appStoreUrl: 'https://apps.apple.com/app/test',
      },
      'admin-1',
    );
    await expect(service.assertVersionSupported('2.2.4', 'android')).rejects.toThrow(
      BadRequestException,
    );
    try {
      await service.assertVersionSupported('2.2.4', 'android');
    } catch (e) {
      const response = (e as BadRequestException).getResponse() as { code: string };
      expect(response.code).toBe('APP_UPDATE_REQUIRED');
    }
  });

  it('allows supported version', async () => {
    await service.updateSettings(
      {
        latestVersion: '2.3.0',
        minimumSupportedVersion: '2.2.5',
        forceUpdate: false,
        releaseType: 'optional',
        title: 't',
        message: 'm',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=test',
        appStoreUrl: 'https://apps.apple.com/app/test',
      },
      'admin-1',
    );
    await expect(service.assertVersionSupported('2.3.0', 'android')).resolves.toBeUndefined();
  });

  it('sends notification via FCM', async () => {
    const result = await service.sendNotification('all', {
      title: '🚀 Creomine 2.3.0 Available',
      body: 'Update now.',
    });
    expect(result.success).toBe(true);
    expect(fcm.sendAppUpdateNotification).toHaveBeenCalled();
  });
});
