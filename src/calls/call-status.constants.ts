export const CALL_LIFECYCLE_STATUSES = [
  'requested',
  'accepted',
  'ringing',
  'ongoing',
  'ended',
  'missed',
  'rejected',
  'cancelled',
] as const;

export type CallLifecycleStatus = (typeof CALL_LIFECYCLE_STATUSES)[number];

export const CALL_REQUEST_STATUSES = [
  'requested',
  'accepted',
  'rejected',
  'missed',
  'cancelled',
] as const;

export type CallRequestStatus = (typeof CALL_REQUEST_STATUSES)[number];

/** Active sessions (not yet terminal). */
export const ACTIVE_CALL_STATUSES: CallLifecycleStatus[] = [
  'requested',
  'accepted',
  'ringing',
  'ongoing',
];

export const TERMINAL_CALL_STATUSES: CallLifecycleStatus[] = [
  'ended',
  'missed',
  'rejected',
  'cancelled',
];
