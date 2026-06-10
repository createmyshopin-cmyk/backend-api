export {
  StartupValidator,
  runStartupValidation,
  type StartupValidatorOptions,
  type ServiceProfile,
} from './startup-validator';
export {
  getPlatformConfig,
  isPlatformConfigReady,
  isStartupValidated,
  isDevelopmentTier,
  isStagingTier,
  isProductionTier,
  mockPaymentsAllowed,
  freezePlatformConfig,
  recordSupabaseProbeResult,
  getSupabaseProbeCache,
  __resetPlatformConfigForTests,
  type PlatformTier,
  type PlatformConfigShape,
} from './platform-config';
export { probeSupabaseReadiness } from './probes/supabase.probe';
