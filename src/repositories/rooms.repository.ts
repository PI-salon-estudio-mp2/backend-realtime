import { FieldValue, Timestamp, type Query } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import type { Mensaje, PaginaHistorial } from "../socket/eventos";
import { armarPagina } from "./paginacion";

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

/** ¿La cuenta sigue teniendo perfil? (false si se eliminó con el socket abierto). */
export async function perfilExiste(uid: string): Promise<boolean> {
  return (await db.collection("users").doc(uid).get()).exists;
}

/** Registra al usuario como miembro de la sala (para la política de US-05). */
export async function agregarMiembro(salaId: string, uid: string): Promise<void> {
  await salas().doc(salaId).update({ miembros: FieldValue.arrayUnion(uid) });
}

const mensajesDe = (salaId: string) => salas().doc(salaId).collection("messages");

/** Una página del historial: se pide uno de más para saber si quedan mensajes más viejos. */
async function pagina(salaId: string, consulta: Query, limite: number): Promise<PaginaHistorial> {
  const snapshot = await consulta.orderBy("creadoEn", "desc").limit(limite + 1).get();
  const { items, hayMas } = armarPagina(snapshot.docs, limite);
  return { mensajes: items.map((doc) => aMensaje(salaId, doc.id, doc.data())), hayMas };
}

/** Últimos mensajes de la sala (al entrar), del más viejo al más nuevo. */
export async function ultimosMensajes(
  salaId: string,
  limite = LIMITE_HISTORIAL
): Promise<PaginaHistorial> {
  return pagina(salaId, mensajesDe(salaId), limite);
}

/** US-11 · Los `limite` mensajes anteriores a `antesDe`, del más viejo al más nuevo. */
export async function mensajesAnteriores(
  salaId: string,
  antesDe: Date,
  limite = LIMITE_HISTORIAL
): Promise<PaginaHistorial> {
  const consulta = mensajesDe(salaId).where("creadoEn", "<", Timestamp.fromDate(antesDe));
  return pagina(salaId, consulta, limite);
}

export async function guardarMensaje(
  salaId: string,
  autorUid: string,
  autorUsername: string,
  texto: string
): Promise<Mensaje> {
  const creadoEn = Timestamp.now();
  const ref = await mensajesDe(salaId).add({
    autorUid,
    autorUsername,
    texto,
    creadoEn,
  });
  return { id: ref.id, salaId, autorUid, autorUsername, texto, creadoEn: creadoEn.toDate().toISOString() };
}
