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

@Injectable()
export class FcmService {
  async sendIncomingCall(payload: IncomingCallPayload): Promise<void> {
    if (!payload.fcmToken) return;
    try {
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
        notification: {
          title: 'Incoming Call',
          body: `${payload.callerName} is calling you`,
        },
        android: {
          priority: 'high',
        },
      });
      console.log(`[FCM] Incoming call sent → ${payload.fcmToken.slice(0, 12)}...`);
    } catch (e) {
      console.warn('[FCM] sendIncomingCall error:', (e as Error).message);
    }
  }
}
