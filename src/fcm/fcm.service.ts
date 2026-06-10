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

export interface WelcomeIncomingCallPayload {
  fcmToken: string;
  guideName: string;
  guideAvatar: string;
  channelName: string;
  callRequestId: string;
  agoraToken: string;
  agoraAppId: string;
  rewardCoins: number;
  assignmentId: string;
  guideUserId: string;
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
  comboCount?: number;
  isPremium?: boolean;
}

export interface GiftReplyFcmPayload {
  fcmToken: string;
  giftTransactionId: string;
  creatorName: string;
  message: string;
}

@Injectable()
export class FcmService {
  async sendWelcomeIncomingCall(payload: WelcomeIncomingCallPayload): Promise<void> {
    if (!payload.fcmToken) return;
    try {
      await admin.messaging().send({
        token: payload.fcmToken,
        data: {
          type: 'welcome_incoming_call',
          callerName: payload.guideName,
          callerAvatar: payload.guideAvatar,
          channelName: payload.channelName,
          callRequestId: payload.callRequestId,
          agoraToken: payload.agoraToken,
          agoraAppId: payload.agoraAppId,
          callType: 'voice',
          callSource: 'welcome',
          assignmentId: payload.assignmentId,
          guideUserId: payload.guideUserId,
          rewardCoins: String(payload.rewardCoins),
          title: 'Welcome to Creomine ❤️',
          subtitle: `${payload.guideName} is calling to help you get started.`,
        },
        android: { priority: 'high' },
        apns: {
          payload: {
            aps: {
              alert: {
                title: 'Welcome to Creomine ❤️',
                body: `${payload.guideName} is calling to help you get started.`,
              },
              sound: 'default',
            },
          },
        },
      });
      console.log(`[FCM] Welcome call sent → ${payload.fcmToken.slice(0, 12)}...`);
    } catch (e) {
      console.warn('[FCM] sendWelcomeIncomingCall error:', (e as Error).message);
    }
  }

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
          comboCount: String(payload.comboCount ?? 1),
          isPremium: String(payload.isPremium ?? false),
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

  async sendAppUpdateNotification(payload: {
    tokens: string[];
    title: string;
    body: string;
    latestVersion: string;
  }): Promise<{ sent: number; failed: number }> {
    const unique = [...new Set(payload.tokens.filter(Boolean))];
    if (unique.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const batchSize = 500;
    for (let i = 0; i < unique.length; i += batchSize) {
      const chunk = unique.slice(i, i + batchSize);
      const response = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: {
          type: 'app_update',
          latestVersion: payload.latestVersion,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high',
          notification: { channelId: 'general' },
        },
        apns: {
          payload: {
            aps: {
              alert: { title: payload.title, body: payload.body },
              sound: 'default',
            },
          },
        },
      });
      sent += response.successCount;
      failed += response.failureCount;
    }
    console.log(`[FCM] App update notification → sent=${sent} failed=${failed}`);
    return { sent, failed };
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
