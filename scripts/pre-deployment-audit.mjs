/**
 * Pre-Deployment Security & Repository Audit
 * Verifies no secrets, env files, or build artifacts are present.
 * Run: node scripts/pre-deployment-audit.mjs
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let pass = true;
const results = [];

function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  if (!ok) pass = false;
  results.push({ status, name, detail });
}

console.log('=== PRE-DEPLOYMENT SECURITY & REPOSITORY AUDIT ===\n');

// ── 1. No .env file committed ─────────────────────────────
const envPath = path.join(ROOT, '.env');
check(
  'No .env file in repository root',
  !fs.existsSync(envPath),
  fs.existsSync(envPath) ? '.env file found — remove before committing!' : ''
);

// ── 2. .env.example exists ────────────────────────────────
const envExamplePath = path.join(ROOT, '.env.example');
check(
  '.env.example template exists',
  fs.existsSync(envExamplePath),
  !fs.existsSync(envExamplePath) ? '.env.example is missing — create it with blank values' : ''
);

// ── 3. No service-account.json committed ─────────────────
const serviceAccountPath = path.join(ROOT, 'config', 'firebase', 'service-account.json');
check(
  'No Firebase service-account.json in repository',
  !fs.existsSync(serviceAccountPath),
  fs.existsSync(serviceAccountPath) ? 'service-account.json found — add to .gitignore and remove it!' : ''
);

// ── 4. .gitignore exists and covers secrets ───────────────
const gitignorePath = path.join(ROOT, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  check('gitignore covers node_modules', content.includes('node_modules'), 'Add node_modules/ to .gitignore');
  check('gitignore covers dist/', content.includes('dist'), 'Add dist/ to .gitignore');
  check('gitignore covers .env', content.includes('.env'), 'Add .env to .gitignore');
} else {
  check('.gitignore exists', false, '.gitignore not found');
}

// ── 5. No node_modules in repo (would be gitignored, but check for tracking) ──
const nmPath = path.join(ROOT, 'node_modules');
// node_modules existing locally is fine — it's excluded by .gitignore
check(
  'node_modules present locally (install ready)',
  fs.existsSync(nmPath),
  'Run npm install before deploying'
);

// ── 6. Required source files exist ───────────────────────
const requiredFiles = [
  'package.json',
  'nest-cli.json',
  'tsconfig.json',
  'src/main.ts',
  'src/app.module.ts',
];
for (const f of requiredFiles) {
  const fPath = path.join(ROOT, f);
  check(`Required file exists: ${f}`, fs.existsSync(fPath));
}

// ── 7. Supabase migrations present ────────────────────────
const migrationsPath = path.join(ROOT, 'supabase', 'migrations');
const hasMigrations =
  fs.existsSync(migrationsPath) &&
  fs.readdirSync(migrationsPath).filter(f => f.endsWith('.sql')).length > 0;
check(
  'Supabase migrations present',
  hasMigrations,
  'No SQL migration files found under supabase/migrations/'
);

// ── 8. No production secrets inside .env.example ──────────
const exampleContent = fs.existsSync(envExamplePath)
  ? fs.readFileSync(envExamplePath, 'utf-8')
  : '';
const hasBareSecrets =
  /SUPABASE_SERVICE_ROLE_KEY=eyJ/.test(exampleContent) ||
  /FIREBASE_PRIVATE_KEY=-----BEGIN/.test(exampleContent);
check(
  'No real secrets in .env.example',
  !hasBareSecrets,
  hasBareSecrets ? '.env.example contains real secret values — replace with placeholders' : ''
);

// ── REPORT ────────────────────────────────────────────────
console.log('Result'.padEnd(6) + '  ' + 'Check');
console.log('─'.repeat(60));
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${r.status.padEnd(4)}  ${r.name}`);
  if (r.detail) console.log(`         ↳ ${r.detail}`);
}
console.log('─'.repeat(60));

const passed = results.filter(r => r.status === 'PASS').length;
const total = results.length;

console.log(`\n${passed}/${total} checks passed\n`);

if (pass) {
  console.log('PRE-DEPLOYMENT AUDIT: PASS ✅');
  console.log('Repository is clean and ready for deployment.\n');
  process.exit(0);
} else {
  console.log('PRE-DEPLOYMENT AUDIT: FAIL ❌');
  console.log('Resolve the issues above before pushing to Git.\n');
  process.exit(1);
}
