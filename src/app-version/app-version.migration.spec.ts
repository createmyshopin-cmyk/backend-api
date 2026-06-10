import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../supabase/migrations/20260611120000_release_management_sprint33g.sql',
  ),
  'utf8',
);

describe('Release management migration (Sprint 3.3G)', () => {
  it('creates app_version_settings singleton table', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.app_version_settings/);
    expect(MIGRATION).toMatch(/uq_app_version_settings_singleton/);
  });

  it('creates append-only app_release_history', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.app_release_history/);
    expect(MIGRATION).toMatch(/release_type IN \('optional', 'force', 'maintenance'\)/);
  });

  it('seeds default settings row', () => {
    expect(MIGRATION).toMatch(/INSERT INTO public\.app_version_settings/);
    expect(MIGRATION).toMatch(/WHERE NOT EXISTS/);
  });

  it('adds version tracking columns on users', () => {
    expect(MIGRATION).toMatch(/app_version TEXT/);
    expect(MIGRATION).toMatch(/app_build_number INTEGER/);
    expect(MIGRATION).toMatch(/app_platform TEXT/);
  });

  it('creates analytics RPC restricted to service_role', () => {
    expect(MIGRATION).toMatch(/get_app_version_analytics/);
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_app_version_analytics TO service_role/,
    );
  });
});
