import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    identity: DecodedIdToken | null;
  }
}

let firebaseConfigured = false;

try {
  if (getApps().length > 0) {
    firebaseConfigured = true;
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const credentials: unknown = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    initializeApp({ credential: cert(credentials as Parameters<typeof cert>[0]) });
    firebaseConfigured = true;
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
    firebaseConfigured = true;
  }
} catch (error) {
  throw new Error("Firebase Admin não pôde ser inicializado. Verifique as credenciais do servidor.", { cause: error });
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!firebaseConfigured) {
    reply.code(503).send({ error: "Autenticação indisponível: configure as credenciais do Firebase no servidor." });
    return;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Token de autenticação obrigatório." });
    return;
  }

  try {
    request.identity = await getAuth().verifyIdToken(authorization.slice(7));
  } catch {
    reply.code(401).send({ error: "Sessão inválida ou expirada. Entre novamente." });
  }
}

export function requireRole(...roles: Array<"therapist" | "guardian">): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.identity) return;
    const role = request.identity.role;
    if ((role !== "therapist" && role !== "guardian") || !roles.includes(role)) {
      reply.code(403).send({ error: "Sua conta não tem permissão para esta ação." });
    }
  };
}
