import * as fs from 'fs';
import * as path from 'path';
import { PlatformTier } from '../platform-config';
import { fatal, ValidationResult } from '../validation-result';

const SA_EMAIL_RE =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/;

export function validateFirebase(
  env: NodeJS.ProcessEnv,
  tier: PlatformTier,
  srcRoot: string,
): ValidationResult {
  const violations = [];
  const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? '';
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim() ?? '';
  const privateKeyRaw = env.FIREBASE_PRIVATE_KEY ?? '';
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n').trim();
  const fileCredentials = env.FIREBASE_ALLOW_FILE_CREDENTIALS === 'true';
  const googleCreds = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  const firebaseAdminPath = path.join(srcRoot, 'auth', 'firebase-admin.ts');
  if (fs.existsSync(firebaseAdminPath)) {
    const source = fs.readFileSync(firebaseAdminPath, 'utf8');
    if (
      (tier === 'staging' || tier === 'production') &&
      source.includes('service-account.json')
    ) {
      violations.push(
        fatal(
          'FB-04',
          'Static service-account.json import is forbidden in staging/production',
          'Use FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY env vars',
        ),
      );
    }
  }

  const saJsonPath = path.join(srcRoot, '..', 'config', 'firebase', 'service-account.json');
  if (
    (tier === 'staging' || tier === 'production') &&
    fs.existsSync(saJsonPath)
  ) {
    violations.push(
      fatal(
        'HC-04',
        'service-account.json must not be present for staging/production boot',
        'Remove local JSON and use environment credentials',
      ),
    );
  }

  const hasEnvTrio = Boolean(projectId && clientEmail && privateKey);
  const hasFilePath = Boolean(googleCreds);

  if (hasEnvTrio && hasFilePath && tier === 'production') {
    violations.push(
      fatal(
        'FB-01',
        'Conflicting Firebase credential sources (env trio and GOOGLE_APPLICATION_CREDENTIALS)',
        'Use only FIREBASE_* env vars in production',
      ),
    );
  }

  if (tier === 'staging' || tier === 'production') {
    if (!projectId) {
      violations.push(
        fatal('FB-02', 'FIREBASE_PROJECT_ID is required', 'Set Firebase project ID from GCP console'),
      );
    }
    if (!clientEmail) {
      violations.push(
        fatal('FB-02', 'FIREBASE_CLIENT_EMAIL is required', 'Set Firebase service account email'),
      );
    }
    if (!privateKey) {
      violations.push(
        fatal('FB-02', 'FIREBASE_PRIVATE_KEY is required', 'Set Firebase private key PEM (escape newlines as \\n)'),
      );
    }
  }

  if (tier === 'development') {
    if (!hasEnvTrio && !fileCredentials) {
      violations.push(
        fatal(
          'FB-06',
          'Firebase credentials required: set FIREBASE_* env trio or FIREBASE_ALLOW_FILE_CREDENTIALS=true with local JSON',
          'Configure Firebase Admin SDK credentials for development',
        ),
      );
    }
  }

  if (projectId && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    violations.push(
      fatal('FB-02', 'FIREBASE_PROJECT_ID format is invalid', 'Use a valid GCP project ID'),
    );
  }

  if (clientEmail && !SA_EMAIL_RE.test(clientEmail)) {
    violations.push(
      fatal('FB-02', 'FIREBASE_CLIENT_EMAIL must be a service account email', 'Use *@*.iam.gserviceaccount.com'),
    );
  }

  if (privateKey && !privateKey.includes('BEGIN PRIVATE KEY')) {
    violations.push(
      fatal('FB-03', 'FIREBASE_PRIVATE_KEY must be a PEM private key', 'Paste PEM with BEGIN PRIVATE KEY header'),
    );
  }

  return { ok: violations.length === 0, violations, warnings: [] };
}

export function resolveFirebaseCredentials(env: NodeJS.ProcessEnv): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? '';
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim() ?? '';
  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  if (env.FIREBASE_ALLOW_FILE_CREDENTIALS === 'true') {
    const filePath = path.join(
      __dirname,
      '..',
      '..',
      'config',
      'firebase',
      'service-account.json',
    );
    if (fs.existsSync(filePath)) {
      const json = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      return {
        projectId: json.project_id ?? '',
        clientEmail: json.client_email ?? '',
        privateKey: json.private_key ?? '',
      };
    }
  }

  return { projectId, clientEmail, privateKey };
}
