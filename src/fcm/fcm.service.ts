import { Injectable } from '@nestjs/common';
import admin from '../auth/firebase-admin';

export interface IncomingCallPayload {
  fcmToken: string;
  callerName: string;
  callerAvatar: string;
  channelName: string;
  callRequestId: string;
  agoraToken: string;
  agoraAppId: string;
  callType: 'voice' | 'video';
}

export interface CallCancelledFcmPayload {
  fcmToken: string;
  callRequestId: string;
}

export interface CallEndedFcmPayload {
  fcmToken: string;
  callSessionId: string;
  callRequestId?: string;
}

export interface GiftReceivedFcmPayload {
  fcmToken: string;
  giftTransactionId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  giftName: string;
  giftCoins: number;
  creatorCoins: number;
}

export interface GiftReplyFcmPayload {
  fcmToken: string;
  giftTransactionId: string;
  creatorName: string;
  message: string;
}

@Injectable()
export class FcmService {
  async sendIncomingCall(payload: IncomingCallPayload): Promise<void> {
    if (!payload.fcmToken) return;
    try {
      // Data-only on Android so the app can show a full-screen incoming-call UI.
      await admin.messaging().send({
        token: payload.fcmToken,
        data: {
          type: 'incoming_call',
          callerName: payload.callerName,
          callerAvatar: payload.callerAvatar,
          channelName: payload.channelName,
          callRequestId: payload.callRequestId,
          agoraToken: payload.agoraToken,
          agoraAppId: payload.agoraAppId,
          callType: payload.callType,
        },
        android: {
          priority: 'high',
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: 'Incoming Call',
                body: `${payload.callerName} is calling you`,
              },
              sound: 'default',
            },
          },
        },
      });
      console.log(`[FCM] Incoming call sent → ${payload.fcmToken.slice(0, 12)}...`);
    } catch (e) {
      console.warn('[FCM] sendIncomingCall error:', (e as Error).message);
    }
  }

  async sendCallCancelled(payload: CallCancelledFcmPayload): Promise<void> {
    if (!payload.fcmToken) return;
    try {
      await admin.messaging().send({
        token: payload.fcmToken,
        data: {
          type: 'call_cancelled',
          callRequestId: payload.callRequestId,
        },
        android: { priority: 'high' },
      });
    } catch (e) {
      console.warn('[FCM] sendCallCancelled error:', (e as Error).message);
    }
  }

  async sendCallEnded(payload: CallEndedFcmPayload): Promise<void> {
    if (!payload.fcmToken) return;
    try {
      await admin.messaging().send({
        token: payload.fcmToken,
        data: {
          type: 'call_ended',
          callSessionId: payload.callSessionId,
          ...(payload.callRequestId
            ? { callRequestId: payload.callRequestId }
            : {}),
        },
        android: { priority: 'high' },
      });
    } catch (e) {
      console.warn('[FCM] sendCallEnded error:', (e as Error).message);
    }
  }

  async sendGiftReceived(payload: GiftReceivedFcmPayload): Promise<void> {
    if (!payload.fcmToken) return;
    const title = `🎁 ${payload.giftName}`;
    const body = `${payload.senderName} sent you a gift`;
    try {
      await admin.messaging().send({
        token: payload.fcmToken,
        notification: { title, body },
        data: {
          type: 'gift_received',
          giftTransactionId: payload.giftTransactionId,
          senderId: payload.senderId,
          senderName: payload.senderName,
          senderAvatar: payload.senderAvatar ?? '',
          giftName: payload.giftName,
          giftCoins: String(payload.giftCoins),
          creatorCoins: String(payload.creatorCoins),
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'gifts',
            tag: payload.giftTransactionId,
          },
        },
      });
    } catch (e) {
      console.warn('[FCM] sendGiftReceived error:', (e as Error).message);
    }
  }

  async sendGiftReply(payload: GiftReplyFcmPayload): Promise<void> {
    if (!payload.fcmToken) return;
    try {
      await admin.messaging().send({
        token: payload.fcmToken,
        notification: {
          title: '💬 Gift Reply',
          body: `${payload.creatorName}: ${payload.message}`,
        },
        data: {
          type: 'gift_reply',
          giftTransactionId: payload.giftTransactionId,
          creatorName: payload.creatorName,
          message: payload.message,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'gifts',
            tag: `reply_${payload.giftTransactionId}`,
          },
        },
      });
    } catch (e) {
      console.warn('[FCM] sendGiftReply error:', (e as Error).message);
    }
  }
}
