import type { Server, Socket } from "socket.io";
import {
  agregarMiembro,
  buscarSala,
  guardarMensaje,
  ultimosMensajes,
} from "../repositories/rooms.repository";
import type {
  Ack,
  DatosSocket,
  ErrorSocket,
  EventosCliente,
  EventosInternos,
  EventosServidor,
  Mensaje,
  SalaUnida,
  UsuarioSocket,
} from "./eventos";

export type ServidorApp = Server<EventosCliente, EventosServidor, EventosInternos, DatosSocket>;
type SocketApp = Socket<EventosCliente, EventosServidor, EventosInternos, DatosSocket>;

/** Mismas reglas del ID que backend-api: 8 caracteres, mayúsculas y números sin 0, O, 1, I, L. */
const ID_SALA_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
export const MAX_MENSAJE = 1000;

const ERRORES = {
  idInvalido: { code: "VALIDATION_ERROR", message: "El ID de la sala tiene 8 caracteres: letras y números, sin espacios." },
  salaNoExiste: { code: "ROOM_NOT_FOUND", message: "No encontramos una sala con ese ID. Revísalo e inténtalo de nuevo." },
  fueraDeSala: { code: "NOT_IN_ROOM", message: "Primero tienes que entrar a la sala." },
  mensajeVacio: { code: "VALIDATION_ERROR", message: "Escribe un mensaje antes de enviarlo." },
  mensajeLargo: { code: "VALIDATION_ERROR", message: `Usa máximo ${MAX_MENSAJE} caracteres por mensaje.` },
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

async function anunciarPresencia(io: ServidorApp, salaId: string) {
  io.to(salaId).emit("presence:update", { salaId, presentes: await presentesEn(io, salaId) });
}

export function registrarEventosDeSala(io: ServidorApp, socket: SocketApp) {
  const usuario = socket.data.usuario;

  /** Entrar a una sala validando su ID. Un socket está en una sola sala a la vez. */
  socket.on("room:join", async (datos, ack) => {
    const responder = responderCon<SalaUnida>(ack);
    const id = normalizarId(datos?.roomId);
    if (!id) return responder({ ok: false, error: ERRORES.idInvalido });

    try {
      const sala = await buscarSala(id);
      if (!sala) return responder({ ok: false, error: ERRORES.salaNoExiste });

      for (const anterior of salasDe(socket)) {
        if (anterior === id) continue;
        await socket.leave(anterior);
        await anunciarPresencia(io, anterior);
      }

      await agregarMiembro(id, usuario.uid);
      await socket.join(id);
      const [historial, presentes] = await Promise.all([ultimosMensajes(id), presentesEn(io, id)]);
      socket.to(id).emit("presence:update", { salaId: id, presentes });

      return responder({
        ok: true,
        data: {
          sala: { ...sala, rol: sala.anfitrionUid === usuario.uid ? "anfitrion" : "invitado" },
          presentes,
          historial,
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
      // Si el anfitrión borró la sala mientras tanto, no se guarda nada (sin mensajes huérfanos).
      if (!(await buscarSala(id))) {
        await socket.leave(id);
        return responder({ ok: false, error: ERRORES.salaNoExiste });
      }
      const mensaje = await guardarMensaje(id, usuario.uid, usuario.username, texto);
      io.to(id).emit("message:new", mensaje);
      return responder({ ok: true, data: mensaje });
    } catch (error) {
      console.error(`Error al guardar un mensaje en la sala ${id}:`, error);
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
