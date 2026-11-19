import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import type { Mensaje } from "../socket/eventos";

/**
 * Mismo modelo de backend-api:
 *   rooms/{id}                    { id, nombre, anfitrionUid, miembros: [uid], creadoEn, actualizadoEn }
 *   rooms/{id}/messages/{msgId}   { autorUid, autorUsername, texto, creadoEn }
 * backend-api crea, renombra y borra salas; este servicio solo agrega miembros y guarda mensajes.
 */

export interface SalaGuardada {
  id: string;
  nombre: string;
  anfitrionUid: string;
}

const salas = () => db.collection("rooms");

export const LIMITE_HISTORIAL = 50;

function aIso(valor: unknown): string {
  return valor instanceof Timestamp ? valor.toDate().toISOString() : "";
}

function aMensaje(salaId: string, id: string, data: Record<string, unknown>): Mensaje {
  return {
    id,
    salaId,
    autorUid: typeof data.autorUid === "string" ? data.autorUid : null,
    autorUsername: typeof data.autorUsername === "string" ? data.autorUsername : "",
    texto: typeof data.texto === "string" ? data.texto : "",
    creadoEn: aIso(data.creadoEn),
  };
}

export async function buscarSala(id: string): Promise<SalaGuardada | null> {
  const snapshot = await salas().doc(id).get();
  if (!snapshot.exists) return null;
  return {
    id: snapshot.id,
    nombre: String(snapshot.get("nombre") ?? ""),
    anfitrionUid: String(snapshot.get("anfitrionUid") ?? ""),
  };
}

/** Registra al usuario como miembro de la sala (para la política de US-05). */
export async function agregarMiembro(salaId: string, uid: string): Promise<void> {
  await salas().doc(salaId).update({ miembros: FieldValue.arrayUnion(uid) });
}

/** Últimos mensajes de la sala, del más viejo al más nuevo. */
export async function ultimosMensajes(salaId: string): Promise<Mensaje[]> {
  const snapshot = await salas()
    .doc(salaId)
    .collection("messages")
    .orderBy("creadoEn", "desc")
    .limit(LIMITE_HISTORIAL)
    .get();
  return snapshot.docs.map((doc) => aMensaje(salaId, doc.id, doc.data())).reverse();
}

export async function guardarMensaje(
  salaId: string,
  autorUid: string,
  autorUsername: string,
  texto: string
): Promise<Mensaje> {
  const creadoEn = Timestamp.now();
  const ref = await salas().doc(salaId).collection("messages").add({
    autorUid,
    autorUsername,
    texto,
    creadoEn,
  });
  return { id: ref.id, salaId, autorUid, autorUsername, texto, creadoEn: creadoEn.toDate().toISOString() };
}
