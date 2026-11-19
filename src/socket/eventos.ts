/**
 * Contrato de eventos de Socket.IO (TS-02). El frontend usa estos mismos nombres y datos.
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

/** Respuesta de room:join: la sala, quiénes están conectados y los últimos mensajes. */
export interface SalaUnida {
  sala: SalaSocket;
  presentes: UsuarioSocket[];
  historial: Mensaje[];
}

/** Lo que el cliente envía al servidor. */
export interface EventosCliente {
  "room:join": (datos: { roomId: string }, ack: Ack<SalaUnida>) => void;
  "room:leave": (datos: { roomId: string }, ack?: Ack<{ salaId: string }>) => void;
  "message:send": (datos: { roomId: string; texto: string }, ack: Ack<Mensaje>) => void;
}

/** Lo que el servidor envía a los clientes. */
export interface EventosServidor {
  "message:new": (mensaje: Mensaje) => void;
  "presence:update": (presencia: Presencia) => void;
}

export type EventosInternos = Record<string, never>;

/** Lo que queda guardado en cada socket después del handshake. */
export interface DatosSocket {
  usuario: UsuarioSocket;
}
