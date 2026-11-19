import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "./env";

if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: env.firebase.projectId,
      clientEmail: env.firebase.clientEmail,
      privateKey: env.firebase.privateKey,
    }),
  });
}

/** Firestore con el Admin SDK (las reglas niegan todo acceso desde clientes). */
export const db = getFirestore();

/** Verifica el ID token que llega en el handshake de Socket.IO. */
export const auth = getAuth();
