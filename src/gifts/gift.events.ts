export const GIFT_EVENT_TYPES = {
  RECEIVED: 'gift_received',
  REPLY: 'gift_reply',
} as const;

export type GiftEventType = (typeof GIFT_EVENT_TYPES)[keyof typeof GIFT_EVENT_TYPES];

export interface GiftReceivedPayload {
  giftTransactionId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  creatorId: string;
  creatorUserId: string;
  giftName: string;
  giftCoins: number;
  creatorCoins: number;
  createdAt: string;
}

export interface GiftReplyPayload {
  giftTransactionId: string;
  message: string;
  creatorName: string;
  creatorUserId: string;
  senderUserId: string;
  createdAt: string;
}
