import { RtcRole, RtcTokenBuilder } from 'agora-token';

export async function probeAgora(appId: string, appCertificate: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    'startup-probe-channel',
    0,
    RtcRole.PUBLISHER,
    expiresAt,
    expiresAt,
  );

  if (!token?.trim()) {
    throw new Error('Agora token generation returned empty token');
  }
}
