/**
 * Read-only API smoke test — no seeding, no mutations.
 *
 * Usage:
 *   node scripts/smoke-test-api.mjs
 *   API_BASE=https://backend-api-production-140f.up.railway.app/api node scripts/smoke-test-api.mjs
 *   API_BASE=http://127.0.0.1:5000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/smoke-test-api.mjs
 */
import 'dotenv/config';

const API_ROOT = (process.env.API_ROOT || 'https://backend-api-production-140f.up.railway.app').replace(/\/$/, '');
const BASE = (process.env.API_BASE || `${API_ROOT}/api`).replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@coincalling.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';

const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ''}`);
}

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

async function api(method, path, token, body) {
  return fetchJson(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  console.log('=== Coin Calling API Smoke Test (read-only) ===\n');
  console.log(`API root:  ${API_ROOT}`);
  console.log(`API base:  ${BASE}`);
  console.log(`Admin:     ${ADMIN_EMAIL}\n`);

  // 1. Root health (no /api prefix)
  {
    const { res, data } = await fetchJson(`${API_ROOT}/`);
    record(
      'Root health GET /',
      res.ok && data?.status === 'ok',
      `status=${res.status} body=${JSON.stringify(data)}`,
    );
  }

  // 2. GET /api alone should 404 (expected — not a bug)
  {
    const { res } = await fetchJson(`${BASE}`);
    record(
      'GET /api returns 404 (expected)',
      res.status === 404,
      `status=${res.status}`,
    );
  }

  // 3. Admin login
  let token = '';
  {
    const { res, data } = await api('POST', '/auth/login', null, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    token = data?.accessToken || '';
    record(
      'Admin login POST /auth/login',
      res.ok && Boolean(token),
      `status=${res.status} user=${data?.user?.email || 'n/a'}`,
    );
  }

  if (!token) {
    console.log('\nCannot continue without admin token.\n');
    printSummary();
    process.exit(1);
  }

  // 4. Protected admin routes
  const adminGets = [
    { name: 'Users list', path: '/users', check: (d) => Array.isArray(d) },
    { name: 'Creators active', path: '/creators/active', check: (d) => Array.isArray(d) },
    { name: 'Creators pending', path: '/creators/pending', check: (d) => Array.isArray(d) },
    { name: 'Calls active', path: '/calls/active', check: (d) => Array.isArray(d) },
    { name: 'Calls history (admin)', path: '/calls', check: (d) => Array.isArray(d) },
    { name: 'Payments history', path: '/payments/history', check: (d) => Array.isArray(d) },
    { name: 'Coin packages', path: '/payments/packages', check: (d) => Array.isArray(d) },
    { name: 'Withdrawals', path: '/admin/withdrawals', check: (d) => Array.isArray(d) },
    { name: 'Wallet transactions', path: '/wallets/transactions', check: (d) => Array.isArray(d) },
    { name: 'Admin settings', path: '/admin/settings', check: (d) => d && typeof d === 'object' },
    { name: 'Admin list', path: '/admin/list', check: (d) => Array.isArray(d) },
  ];

  for (const { name, path, check } of adminGets) {
    const { res, data } = await api('GET', path, token);
    const ok = res.ok && check(data);
    record(name, ok, `GET ${path} -> status=${res.status} count=${Array.isArray(data) ? data.length : 'object'}`);
  }

  // 5. Finance dashboard endpoints
  const financeGets = [
    '/admin/finance/overview',
    '/admin/finance/revenue-chart?days=7',
    '/admin/finance/top-creators',
    '/admin/finance/call-analytics',
    '/admin/finance/withdrawal-analytics',
  ];

  for (const path of financeGets) {
    const { res, data } = await api('GET', path, token);
    const ok = res.ok && data !== null && data !== undefined;
    record(`Finance ${path.split('?')[0]}`, ok, `status=${res.status}`);
  }

  // 6. Unauthorized should fail
  {
    const { res } = await api('GET', '/users', null);
    record('Users without token rejected', res.status === 401 || res.status === 403, `status=${res.status}`);
  }

  printSummary();
  const failed = results.filter((r) => !r.pass).length;
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailed checks:');
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
