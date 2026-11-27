import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { DatosSocket, EventosCliente, EventosInternos, EventosServidor } from "./eventos";
import { anunciarPresencia, registrarEventosDeSala, RepositorioSalas, ServidorApp } from "./salas.handlers";

type Middleware = Parameters<ServidorApp["use"]>[0];

/** Cuánto tiempo se guarda la sesión de un socket caído para recuperarla al reconectar. */
export const RECUPERACION_MS = 2 * 60 * 1000;

/**
 * Crea el servidor Socket.IO con su configuración. Lo usan src/index.ts (producción) y las pruebas.
 *
 * Reconexión: el cliente de Socket.IO reintenta solo (1 s, 2 s, … hasta 8 s) y, al volver,
 * el frontend emite otra vez room:join con la sala en la que estaba. Además, si la caída dura
 * menos de 2 minutos, connectionStateRecovery recupera las salas del socket y le reenvía los
 * mensajes que se perdió mientras estaba desconectado. El handshake (token) se vuelve a verificar.
 */
export function crearServidorSocket(
  httpServer: HttpServer,
  opciones: { corsOrigins: string[]; autenticar: Middleware; repo: RepositorioSalas }
): ServidorApp {
  const io = new Server<EventosCliente, EventosServidor, EventosInternos, DatosSocket>(httpServer, {
    cors: { origin: opciones.corsOrigins, methods: ["GET", "POST"] },
    connectionStateRecovery: { maxDisconnectionDuration: RECUPERACION_MS, skipMiddlewares: false },
  });

  // Handshake: sin ID token válido no hay conexión (también al reconectar).
  io.use(opciones.autenticar);

  io.on("connection", (socket) => {
    registrarEventosDeSala(io, socket, opciones.repo);
    // Sesión recuperada: ya está en sus salas; los demás vuelven a verlo como presente.
    if (socket.recovered) {
      for (const salaId of socket.rooms) {
        if (salaId !== socket.id) void anunciarPresencia(io, salaId);
      }
    }
  });

  return io;
}
