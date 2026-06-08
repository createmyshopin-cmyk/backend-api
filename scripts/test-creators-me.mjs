#!/usr/bin/env node
/**
 * Test GET /api/creators/me and related creator profile routes.
 *
 * Usage:
 *   node scripts/test-creators-me.mjs
 *   CREATOR_ACCESS_TOKEN=<jwt> node scripts/test-creators-me.mjs
 */
import 'dotenv/config';

const API_ROOT = (process.env.API_ROOT || 'https://api.creomine.com').replace(/\/$/, '');
const BASE = `${API_ROOT}/api`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@coincalling.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';
const CREATOR_TOKEN = process.env.CREATOR_ACCESS_TOKEN?.trim() || '';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data };
}

function log(name, pass, detail = '') {
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('=== GET /api/creators/me test ===\n');
  console.log(`API: ${BASE}\n`);

  const { res: loginRes, data: loginData } = await fetchJson(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  const adminToken = loginData?.accessToken;
  log('Admin login', loginRes.ok && Boolean(adminToken), `status=${loginRes.status}`);

  if (!adminToken) {
    process.exit(1);
  }

  const { res: usersRes, data: users } = await fetchJson(`${BASE}/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const creators = Array.isArray(users) ? users.filter((u) => u.isCreator) : [];
  const creator = creators[0];
  log(
    'Find creator user',
    Boolean(creator?.id),
    creator ? `${creator.name} (${creator.id})` : 'none',
  );

  if (creator?.id) {
    const { res, data } = await fetchJson(`${BASE}/creators/${creator.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    log(
      `GET /creators/:id (${creator.name})`,
      res.ok && data?.id === creator.id,
      `status=${res.status} name=${data?.name ?? 'n/a'}`,
    );
  }

  {
    const { res, data } = await fetchJson(`${BASE}/creators/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const isMeRoute =
      res.status === 404 &&
      typeof data?.message === 'string' &&
      !data.message.includes('ID me not found');
    log(
      'GET /creators/me with admin token',
      res.status === 404 && isMeRoute,
      `status=${res.status} (admin is not a creator — 404 expected) msg=${data?.message ?? ''}`,
    );
  }

  if (CREATOR_TOKEN) {
    const { res, data } = await fetchJson(`${BASE}/creators/me`, {
      headers: { Authorization: `Bearer ${CREATOR_TOKEN}` },
    });
    log(
      'GET /creators/me with creator JWT',
      res.ok && Boolean(data?.id),
      `status=${res.status} id=${data?.id ?? 'n/a'} name=${data?.name ?? 'n/a'}`,
    );
    if (!res.ok) {
      console.log('  body:', JSON.stringify(data));
    }
  } else {
    console.log('\n[INFO] Set CREATOR_ACCESS_TOKEN to test /creators/me as creator (200).');
    console.log('  Get JWT: log into app as creator → POST /api/auth/firebase-login returns accessToken');
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
