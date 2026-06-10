import * as admin from 'firebase-admin';
import { getPlatformConfig, isPlatformConfigReady } from '../startup/platform-config';

let initialized = false;

function ensureFirebaseAdmin(): typeof admin {
  if (!initialized) {
    if (!isPlatformConfigReady()) {
      throw new Error(
        'Firebase Admin cannot initialize before StartupValidator completes',
      );
    }
    const { firebase } = getPlatformConfig();
    if (!firebase.projectId || !firebase.clientEmail || !firebase.privateKey) {
      throw new Error('Firebase credentials missing from PlatformConfig');
    }
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: firebase.projectId,
        clientEmail: firebase.clientEmail,
        privateKey: firebase.privateKey,
      }),
    });
    initialized = true;
  }
  return admin;
}

const firebaseProxy = new Proxy({} as typeof admin, {
  get(_target, prop) {
    const sdk = ensureFirebaseAdmin();
    const value = (sdk as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(sdk) : value;
  },
});

export default firebaseProxy;
