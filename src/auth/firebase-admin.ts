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
  credentialValue = admin.credential.cert({
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  });
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
