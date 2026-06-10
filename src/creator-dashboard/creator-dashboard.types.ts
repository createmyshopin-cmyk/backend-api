export type CreatorProfileStatus = 'pending' | 'active' | 'suspended' | 'rejected';

export interface CreatorRequestScope {
  userId: string;
  creatorProfileId: string;
  profileStatus: CreatorProfileStatus;
  isSuspended: boolean;
  isWalletFrozen: boolean;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  isOnline: boolean;
  accountCreatedAt: string;
}

export interface WalletSnapshot {
  availableBalance: number;
  lockedBalance: number;
  withdrawnAmount: number;
  totalEarned: number;
  callEarningsTotal: number;
  giftEarningsTotal: number;
  asOf: string;
}

export interface AnalyticsMetrics {
  totalEarnings: number;
  callEarnings: number;
  giftEarnings: number;
  callCount: number;
  giftCount: number;
  talkMinutes: number;
}

export interface ChartDayPoint {
  date: string;
  totalEarnings: number;
  callEarnings: number;
  giftEarnings: number;
  callCount: number;
  giftCount: number;
}

export interface CallHistoryRow {
  callId: string;
  callerDisplayName: string;
  callerAvatarUrl: string | null;
  status: string;
  type: string;
  durationSeconds: number;
  earnings: number;
  startedAt: string;
  endedAt: string | null;
}

export interface GiftHistoryRow {
  transactionId: string;
  giftId: string | null;
  giftName: string;
  giftIconUrl: string | null;
  giftDeleted: boolean;
  senderDisplayName: string;
  creatorCoins: number;
  callId: string | null;
  createdAt: string;
}

export interface WithdrawalHistoryRow {
  withdrawalId: string;
  amount: number;
  status: string;
  statusLabel: string;
  userMessage: string | null;
  requestedAt: string;
  paidAt: string | null;
  paymentReference: string | null;
  payoutMethodMasked: string | null;
}

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}
