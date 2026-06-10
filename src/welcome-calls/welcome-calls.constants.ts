export const WELCOME_ASSIGNMENT_STATUSES = [
  'pending',
  'accepted',
  'completed',
  'expired',
  'cancelled',
] as const;

export type WelcomeAssignmentStatus = (typeof WELCOME_ASSIGNMENT_STATUSES)[number];

export const WELCOME_ASSIGNMENT_STRATEGIES = [
  'random',
  'online',
  'top_rated',
  'legend',
] as const;

export type WelcomeAssignmentStrategy = (typeof WELCOME_ASSIGNMENT_STRATEGIES)[number];

export const CALL_SOURCES = ['normal', 'welcome', 'support', 'campaign'] as const;
export type CallSource = (typeof CALL_SOURCES)[number];

/** Default opportunity TTL before expiry */
export const WELCOME_ASSIGNMENT_TTL_MS = 15 * 60 * 1000;
