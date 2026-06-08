#!/usr/bin/env node
/**
 * End-to-end test: firebase login as creator phone +919876543210 → GET /creators/me
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = (process.env.API_ROOT || 'https://api.creomine.com').replace(/\/$/, '');
const BASE = `${API_ROOT}/api`;
const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || 'AIzaSyApPlisDVZjSuHfi4CWPUIJEeHuEuJeyas';
const CREATOR_FIREBASE_UID =
  process.env.CREATOR_FIREBASE_UID || 'cSpajIKyZOeliLpqmB0SFfnrUk52';
const CREATOR_PHONE = process.env.CREATOR_PHONE || '+919876543210';

const saPath = join(__dirname, '..', 'config', 'firebase', 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(saPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function main() {
  console.log('=== Creator /creators/me test for', CREATOR_PHONE, '===\n');

  const user = await admin.auth().getUser(CREATOR_FIREBASE_UID);
  console.log('Firebase user:', user.uid, user.phoneNumber || '(no phone on record)');

  const customToken = await admin.auth().createCustomToken(CREATOR_FIREBASE_UID);
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const signInData = await signInRes.json();
  if (!signInRes.ok) {
    console.error('Firebase signInWithCustomToken failed:', signInData);
    process.exit(1);
  }

  const idToken = signInData.idToken;
  console.log('Firebase idToken obtained (length', idToken.length + ')');

  const loginRes = await fetch(`${BASE}/auth/firebase-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firebaseToken: idToken }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error('POST /auth/firebase-login failed:', loginRes.status, loginData);
    process.exit(1);
  }

  const accessToken = loginData.accessToken;
  console.log('App accessToken obtained for user', loginData.user?.id, loginData.user?.name);

  const meRes = await fetch(`${BASE}/creators/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();

  if (meRes.ok) {
    console.log('\n[PASS] GET /api/creators/me →', meRes.status);
    console.log(JSON.stringify(meData, null, 2));
  } else {
    console.error('\n[FAIL] GET /api/creators/me →', meRes.status, meData);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
