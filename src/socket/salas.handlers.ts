import type { Server, Socket } from "socket.io";
import type { SalaGuardada } from "../repositories/rooms.repository";
import type {
  Ack,
  DatosSocket,
  ErrorSocket,
  EventosCliente,
  EventosInternos,
  EventosServidor,
  Mensaje,
  PaginaHistorial,
  SalaUnida,
  UsuarioSocket,
} from "./eventos";

/**
 * Lo que los eventos necesitan de Firestore. En producción es repositories/rooms.repository;
 * en las pruebas (tests/) se usa uno en memoria.
 */
export interface RepositorioSalas {
  buscarSala(id: string): Promise<SalaGuardada | null>;
  perfilExiste(uid: string): Promise<boolean>;
  agregarMiembro(salaId: string, uid: string): Promise<void>;
  ultimosMensajes(salaId: string, limite?: number): Promise<PaginaHistorial>;
  mensajesAnteriores(salaId: string, antesDe: Date, limite?: number): Promise<PaginaHistorial>;
  guardarMensaje(salaId: string, autorUid: string, autorUsername: string, texto: string): Promise<Mensaje>;
}

export type ServidorApp = Server<EventosCliente, EventosServidor, EventosInternos, DatosSocket>;
type SocketApp = Socket<EventosCliente, EventosServidor, EventosInternos, DatosSocket>;

/** Mismas reglas del ID que backend-api: 8 caracteres, mayúsculas y números sin 0, O, 1, I, L. */
const ID_SALA_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
export const MAX_MENSAJE = 1000;
/** Mensajes por página del historial (al entrar y en cada history:before). */
export const LIMITE_PAGINA = 50;

const ERRORES = {
  idInvalido: { code: "VALIDATION_ERROR", message: "El ID de la sala tiene 8 caracteres: letras y números, sin espacios." },
  salaNoExiste: { code: "ROOM_NOT_FOUND", message: "No encontramos una sala con ese ID. Revísalo e inténtalo de nuevo." },
  fueraDeSala: { code: "NOT_IN_ROOM", message: "Primero tienes que entrar a la sala." },
  mensajeVacio: { code: "VALIDATION_ERROR", message: "Escribe un mensaje antes de enviarlo." },
  mensajeLargo: { code: "VALIDATION_ERROR", message: `Usa máximo ${MAX_MENSAJE} caracteres por mensaje.` },
  fechaInvalida: { code: "VALIDATION_ERROR", message: "La fecha del mensaje más antiguo no es válida." },
  limiteInvalido: { code: "VALIDATION_ERROR", message: `Pide entre 1 y ${LIMITE_PAGINA} mensajes por vez.` },
  salaSigueExistiendo: { code: "ROOM_STILL_EXISTS", message: "La sala todavía existe. Elimínala primero desde «Mis salas»." },
  sinCuenta: { code: "UNAUTHORIZED", message: "Tu sesión no es válida o expiró. Inicia sesión de nuevo." },
  servidor: { code: "SERVER_UNAVAILABLE", message: "No se pudo conectar con la base de datos. Inténtalo de nuevo." },
} satisfies Record<string, ErrorSocket>;

function normalizarId(valor: unknown): string | null {
  const id = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  return ID_SALA_REGEX.test(id) ? id : null;
}

/** Si el cliente no mandó callback, se responde a la nada (sin romper el servidor). */
function responderCon<T>(ack: unknown): Ack<T> {
  return typeof ack === "function" ? (ack as Ack<T>) : () => undefined;
}

/** Salas de Socket.IO en las que está el socket (sin contar su sala privada, que es su id). */
function salasDe(socket: SocketApp): string[] {
  return [...socket.rooms].filter((sala) => sala !== socket.id);
}

/** Usuarios conectados ahora en la sala (uno por uid, aunque tenga varias pestañas). */
async function presentesEn(io: ServidorApp, salaId: string): Promise<UsuarioSocket[]> {
  const sockets = await io.in(salaId).fetchSockets();
  const porUid = new Map<string, UsuarioSocket>();
  for (const s of sockets) porUid.set(s.data.usuario.uid, s.data.usuario);
  return [...porUid.values()];
}

export async function anunciarPresencia(io: ServidorApp, salaId: string) {
  io.to(salaId).emit("presence:update", { salaId, presentes: await presentesEn(io, salaId) });
}

/**
 * US-07 · Avisa a todos los conectados que la sala ya no existe y los saca de ella.
 * Lo usan room:closed (aviso del anfitrión) y message:send (si alguien escribe en una sala borrada).
 */
function cerrarSala(io: ServidorApp, salaId: string) {
  io.to(salaId).emit("room:deleted", { salaId });
  io.in(salaId).socketsLeave(salaId);
}

/** Fecha ISO válida (la del mensaje más viejo en pantalla), o null. */
function leerFecha(valor: unknown): Date | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Límite de la página: si no viene se usan 50; fuera de 1–50 es un error. */
function leerLimite(valor: unknown): number | null {
  if (valor === undefined || valor === null) return LIMITE_PAGINA;
  return Number.isInteger(valor) && (valor as number) >= 1 && (valor as number) <= LIMITE_PAGINA
    ? (valor as number)
    : null;
}

export function registrarEventosDeSala(io: ServidorApp, socket: SocketApp, repo: RepositorioSalas) {
  const usuario = socket.data.usuario;

  /** Entrar a una sala validando su ID. Un socket está en una sola sala a la vez. */
  socket.on("room:join", async (datos, ack) => {
    const responder = responderCon<SalaUnida>(ack);
    const id = normalizarId(datos?.roomId);
    if (!id) return responder({ ok: false, error: ERRORES.idInvalido });

    try {
      const sala = await repo.buscarSala(id);
      if (!sala) return responder({ ok: false, error: ERRORES.salaNoExiste });

      for (const anterior of salasDe(socket)) {
        if (anterior === id) continue;
        await socket.leave(anterior);
        await anunciarPresencia(io, anterior);
      }

      await repo.agregarMiembro(id, usuario.uid);
      await socket.join(id);
      const [historial, presentes] = await Promise.all([repo.ultimosMensajes(id, LIMITE_PAGINA), presentesEn(io, id)]);
      socket.to(id).emit("presence:update", { salaId: id, presentes });

      return responder({
        ok: true,
        data: {
          sala: { ...sala, rol: sala.anfitrionUid === usuario.uid ? "administrador" : "invitado" },
          presentes,
          historial: historial.mensajes,
          hayMasHistorial: historial.hayMas,
        },
      });
    } catch (error) {
      console.error(`Error al entrar a la sala ${id}:`, error);
      return responder({ ok: false, error: ERRORES.servidor });
    }
  });

  /** Salir de la sala. */
  socket.on("room:leave", async (datos, ack) => {
    const responder = responderCon<{ salaId: string }>(ack);
    const id = normalizarId(datos?.roomId);
    if (!id || !socket.rooms.has(id)) return responder({ ok: false, error: ERRORES.fueraDeSala });
    await socket.leave(id);
    await anunciarPresencia(io, id);
    return responder({ ok: true, data: { salaId: id } });
  });

  /**
   * Enviar un mensaje: se guarda en rooms/{id}/messages y se emite SOLO a la misma sala
   * (incluido quien lo envió, para que vea la hora y el id con que quedó guardado).
   */
  socket.on("message:send", async (datos, ack) => {
    const responder = responderCon<Mensaje>(ack);
    const id = normalizarId(datos?.roomId);
    if (!id || !socket.rooms.has(id)) return responder({ ok: false, error: ERRORES.fueraDeSala });

    const texto = typeof datos?.texto === "string" ? datos.texto.trim() : "";
    if (!texto) return responder({ ok: false, error: ERRORES.mensajeVacio });
    if (texto.length > MAX_MENSAJE) return responder({ ok: false, error: ERRORES.mensajeLargo });

    try {
      // Sin mensajes huérfanos: si el anfitrión borró la sala, o si quien escribe eliminó
      // su cuenta (US-05) con este socket todavía abierto, no se guarda nada.
      const [sala, conPerfil] = await Promise.all([repo.buscarSala(id), repo.perfilExiste(usuario.uid)]);
      if (!conPerfil) {
        socket.disconnect(true);
        return responder({ ok: false, error: ERRORES.sinCuenta });
      }
      if (!sala) {
        // La sala se borró y nadie avisó con room:closed: se avisa ahora a todos los que siguen dentro.
        cerrarSala(io, id);
        return responder({ ok: false, error: ERRORES.salaNoExiste });
      }
      const mensaje = await repo.guardarMensaje(id, usuario.uid, usuario.username, texto);
      io.to(id).emit("message:new", mensaje);
      return responder({ ok: true, data: mensaje });
    } catch (error) {
      console.error(`Error al guardar un mensaje en la sala ${id}:`, error);
      return responder({ ok: false, error: ERRORES.servidor });
    }
  });

  /**
   * US-11 · Historial por partes: los mensajes anteriores al más viejo que el cliente ya tiene.
   * Solo para quien está dentro de la sala (los mensajes nunca salen de su sala).
   */
  socket.on("history:before", async (datos, ack) => {
    const responder = responderCon<PaginaHistorial>(ack);
    const id = normalizarId(datos?.roomId);
    if (!id || !socket.rooms.has(id)) return responder({ ok: false, error: ERRORES.fueraDeSala });

    const antesDe = leerFecha(datos?.antesDe);
    if (!antesDe) return responder({ ok: false, error: ERRORES.fechaInvalida });
    const limite = leerLimite(datos?.limite);
    if (limite === null) return responder({ ok: false, error: ERRORES.limiteInvalido });

    try {
      return responder({ ok: true, data: await repo.mensajesAnteriores(id, antesDe, limite) });
    } catch (error) {
      console.error(`Error al leer el historial de la sala ${id}:`, error);
      return responder({ ok: false, error: ERRORES.servidor });
    }
  });

  /**
   * US-07 · El anfitrión ya borró la sala con DELETE /api/rooms/:id (que exige ser anfitrión → 403).
   * Antes de avisar se comprueba en Firestore que la sala ya no existe: así nadie puede
   * «cerrar» una sala que sigue viva. Luego todos los conectados reciben room:deleted.
   */
  socket.on("room:closed", async (datos, ack) => {
    const responder = responderCon<{ salaId: string }>(ack);
    const id = normalizarId(datos?.roomId);
    if (!id) return responder({ ok: false, error: ERRORES.idInvalido });

    try {
      if (await repo.buscarSala(id)) return responder({ ok: false, error: ERRORES.salaSigueExistiendo });
      cerrarSala(io, id);
      return responder({ ok: true, data: { salaId: id } });
    } catch (error) {
      console.error(`Error al cerrar la sala ${id}:`, error);
      return responder({ ok: false, error: ERRORES.servidor });
    }
  });

  // Al desconectarse, los demás de la sala ven la presencia actualizada.
  let salasAlSalir: string[] = [];
  socket.on("disconnecting", () => {
    salasAlSalir = salasDe(socket);
  });
  socket.on("disconnect", () => {
    for (const salaId of salasAlSalir) void anunciarPresencia(io, salaId);
  });
}
