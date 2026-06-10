import * as admin from 'firebase-admin';

export async function probeFirebase(credentials: {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}): Promise<void> {
  const appName = `startup-probe-${Date.now()}`;
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert({
        projectId: credentials.projectId,
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey,
      }),
    },
    appName,
  );

  try {
    await admin.auth(app).listUsers(1);
  } finally {
    await app.delete().catch(() => undefined);
  }
}
