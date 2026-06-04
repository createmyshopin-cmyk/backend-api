import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// firebase-admin v12+ removed `admin.Credential` from the top-level namespace.
// We infer the type from the credential factory return value instead.
type FirebaseCredential = ReturnType<typeof admin.credential.cert>;

let credentialValue: FirebaseCredential | ReturnType<typeof admin.credential.applicationDefault>;

const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (privateKey && clientEmail && projectId) {
  let formattedPrivateKey = privateKey
    .trim()
    .replace(/^["']/, '')
    .replace(/["']$/, '')
    .replace(/\\n/g, '\n');

  // Auto-repair common copy-paste typo where \nMII became \nnMII or nMII
  if (formattedPrivateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    const lines = formattedPrivateKey.split('\n').map(line => line.trim());
    const headerIndex = lines.findIndex(line => line.includes('BEGIN PRIVATE KEY'));
    if (headerIndex !== -1 && headerIndex + 1 < lines.length) {
      const firstBodyLine = lines[headerIndex + 1];
      if (firstBodyLine.startsWith('nMII')) {
        lines[headerIndex + 1] = firstBodyLine.substring(1); // remove the typo 'n'
      }
    }
    formattedPrivateKey = lines.join('\n');
  }

  try {
    credentialValue = admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: formattedPrivateKey,
    });
  } catch (error) {
    console.error('=== FIREBASE KEY DIAGNOSTICS ===');
    console.error(`Key length: ${formattedPrivateKey.length}`);
    console.error(`Starts with header: ${formattedPrivateKey.startsWith('-----BEGIN PRIVATE KEY-----')}`);
    console.error(`Ends with footer: ${formattedPrivateKey.endsWith('-----END PRIVATE KEY-----')}`);
    const lines = formattedPrivateKey.split('\n');
    console.error(`Number of lines: ${lines.length}`);
    if (lines.length > 1) {
      console.error(`Line 1 prefix (first 10 chars): "${lines[1].substring(0, 10)}"`);
    }
    console.error('================================');
    throw error;
  }
} else {
  const serviceAccountPath = path.resolve(__dirname, '../../config/firebase/service-account.json');
  if (fs.existsSync(serviceAccountPath)) {
    const raw = fs.readFileSync(serviceAccountPath, 'utf8');
    credentialValue = admin.credential.cert(JSON.parse(raw));
  } else {
    console.warn('Firebase configuration missing: using default credentials.');
    credentialValue = admin.credential.applicationDefault();
  }
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: credentialValue,
  });
}

export default admin;
