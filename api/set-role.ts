import "dotenv/config";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [uid, role] = process.argv.slice(2);
if (!uid || (role !== "therapist" && role !== "guardian")) {
  console.error("Uso: npm run set:role -- <firebase-uid> <therapist|guardian>");
  process.exitCode = 1;
} else {
  if (getApps().length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const credentials: unknown = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      initializeApp({ credential: cert(credentials as Parameters<typeof cert>[0]) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
    } else {
      throw new Error("Configure GOOGLE_APPLICATION_CREDENTIALS ou FIREBASE_SERVICE_ACCOUNT_JSON.");
    }
  }

  const auth = getAuth();
  const existingUser = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...existingUser.customClaims, role });
  console.info(`Permissão "${role}" definida para a conta ${uid}. Entre novamente para atualizar a sessão.`);
}
