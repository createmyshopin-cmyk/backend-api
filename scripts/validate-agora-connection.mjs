#!/usr/bin/env node
/**
 * Validates Agora env + token generation for a sample channel.
 * Usage: node scripts/validate-agora-connection.mjs [channelName]
 */
import agoraToken from 'agora-token';
import 'dotenv/config';

const { RtcTokenBuilder, RtcRole } = agoraToken;

const channelName = process.argv[2] ?? `ch_${Date.now()}`;
const uid = 0;
const appId = process.env.AGORA_APP_ID?.trim() ?? '';
const appCertificate = process.env.AGORA_APP_CERTIFICATE?.trim() ?? '';
const fallbackToken = process.env.AGORA_TOKEN?.trim() ?? '';

console.log('=== Agora Connection Validation ===');
console.log(`CHANNEL_NAME=${channelName}`);
console.log(`UID=${uid}`);
console.log(`APP_ID=${appId || '(missing)'}`);
console.log(`CERTIFICATE=${appCertificate ? 'set' : 'missing'}`);

let token = '';
if (appId && appCertificate) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expiresAt,
    expiresAt,
  );
} else {
  token = fallbackToken;
  if (token) {
    console.warn(
      'WARN: Using AGORA_TOKEN fallback — will NOT work for dynamic ch_* channels.',
    );
  }
}

if (!appId) {
  console.error('FAIL: AGORA_APP_ID is not set');
  process.exit(1);
}

if (!token) {
  console.error(
    'FAIL: No token — set AGORA_APP_CERTIFICATE or AGORA_TOKEN in .env',
  );
  process.exit(1);
}

const preview = token.length > 20 ? `${token.slice(0, 20)}…` : token;
console.log(`TOKEN_CREATED=${preview}`);
console.log('PASS: Token generation OK');
