/**
 * Contrato de eventos de Socket.IO (TS-02 y Sprint 3). El frontend usa estos mismos nombres y datos
 * (frontend/docs/chat-tiempo-real.md). La documentación completa está en docs/eventos-tiempo-real.md.
 * Todas las respuestas (ack) tienen la forma { ok: true, data } o { ok: false, error: { code, message } }.
 */

export interface ErrorSocket {
  code: string;
  message: string;
}

export type Respuesta<T> = { ok: true; data: T } | { ok: false; error: ErrorSocket };
export type Ack<T> = (respuesta: Respuesta<T>) => void;

export interface UsuarioSocket {
  uid: string;
  username: string;
  avatar: string;
}

export interface SalaSocket {
  id: string;
  nombre: string;
  anfitrionUid: string;
  /** «administrador» = quien creó la sala (mismo nombre que usa el frontend). */
  rol: "administrador" | "invitado";
}

export interface Mensaje {
  id: string;
  salaId: string;
  autorUid: string | null;
  autorUsername: string;
  texto: string;
  creadoEn: string; // ISO 8601
}

export interface Presencia {
  salaId: string;
  presentes: UsuarioSocket[];
}

/** Una página del historial, del mensaje más viejo al más nuevo. */
export interface PaginaHistorial {
  mensajes: Mensaje[];
  /** true si en Firestore quedan mensajes más viejos que el primero de la página. */
  hayMas: boolean;
}

/** Respuesta de room:join: la sala, quiénes están conectados y los últimos mensajes. */
export interface SalaUnida {
  sala: SalaSocket;
  presentes: UsuarioSocket[];
  historial: Mensaje[];
  /** US-11 · true si hay mensajes más viejos que los del historial (se piden con history:before). */
  hayMasHistorial: boolean;
}

/** Lo que el cliente envía al servidor. */
export interface EventosCliente {
  "room:join": (datos: { roomId: string }, ack: Ack<SalaUnida>) => void;
  "room:leave": (datos: { roomId: string }, ack?: Ack<{ salaId: string }>) => void;
  "message:send": (datos: { roomId: string; texto: string }, ack: Ack<Mensaje>) => void;
  /** US-11 · Mensajes anteriores a `antesDe` (ISO), de a `limite` (máximo 50). */
  "history:before": (
    datos: { roomId: string; antesDe: string; limite?: number },
    ack: Ack<PaginaHistorial>
  ) => void;
  /** US-07 · El anfitrión avisa que ya eliminó la sala con DELETE /api/rooms/:id. */
  "room:closed": (datos: { roomId: string }, ack?: Ack<{ salaId: string }>) => void;
}

/** Lo que el servidor envía a los clientes. */
export interface EventosServidor {
  "message:new": (mensaje: Mensaje) => void;
  "presence:update": (presencia: Presencia) => void;
  /** US-07 · La sala ya no existe: el frontend avisa y lleva a «Mis salas». */
  "room:deleted": (datos: { salaId: string }) => void;
}

export type EventosInternos = Record<string, never>;

/** Lo que queda guardado en cada socket después del handshake. */
export interface DatosSocket {
  usuario: UsuarioSocket;
}
