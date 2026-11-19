import type { Socket } from "socket.io";
import { auth, db } from "../config/firebase";
import type { DatosSocket, EventosCliente, EventosInternos, EventosServidor } from "./eventos";

type SocketApp = Socket<EventosCliente, EventosServidor, EventosInternos, DatosSocket>;

/**
 * Error que recibe el cliente en `connect_error`: `err.message` (texto para mostrar)
 * y `err.data.code` (UNAUTHORIZED, PROFILE_INCOMPLETE o SERVER_UNAVAILABLE).
 */
class ErrorDeConexion extends Error {
  data: { code: string };
  constructor(code: string, message: string) {
    super(message);
    this.data = { code };
  }
}

const MENSAJE_401 = "Tu sesión no es válida o expiró. Inicia sesión de nuevo.";

/** Errores del Admin SDK que significan «no pude verificar», no «el token es inválido». */
const ERRORES_DE_SERVICIO = new Set(["app/network-error", "auth/internal-error"]);

function codigoDe(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

/**
 * Handshake autenticado (TS-02): el cliente se conecta con
 *   io(URL, { auth: { token: <ID token de Firebase> } })
 * Sin token, con token inválido, expirado o de una cuenta eliminada → se rechaza la conexión.
 * Si es válido, se carga el perfil (username y avatar) y queda en socket.data.usuario.
 */
export async function autenticarSocket(socket: SocketApp, next: (err?: Error) => void) {
  const crudo: unknown = socket.handshake.auth?.token;
  const token = typeof crudo === "string" ? crudo.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return next(new ErrorDeConexion("UNAUTHORIZED", MENSAJE_401));

  let uid: string;
  try {
    uid = (await auth.verifyIdToken(token, true)).uid;
  } catch (error) {
    if (ERRORES_DE_SERVICIO.has(codigoDe(error))) {
      console.error("No se pudo verificar el token con Firebase:", error);
      return next(
        new ErrorDeConexion("SERVER_UNAVAILABLE", "No pudimos verificar tu sesión. Reintentando…")
      );
    }
    return next(new ErrorDeConexion("UNAUTHORIZED", MENSAJE_401));
  }

  try {
    const perfil = await db.collection("users").doc(uid).get();
    if (!perfil.exists) {
      return next(
        new ErrorDeConexion(
          "PROFILE_INCOMPLETE",
          "Falta elegir tu nombre de usuario para terminar de crear la cuenta."
        )
      );
    }
    socket.data.usuario = {
      uid,
      username: String(perfil.get("username") ?? ""),
      avatar: String(perfil.get("avatar") ?? ""),
    };
    return next();
  } catch (error) {
    console.error("Error de Firestore (leer perfil en el handshake):", error);
    return next(
      new ErrorDeConexion("SERVER_UNAVAILABLE", "No se pudo conectar con la base de datos. Reintentando…")
    );
  }
}
