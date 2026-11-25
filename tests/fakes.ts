/**
 * Dobles de prueba: un «servidor Socket.IO» en memoria y un repositorio de Firestore en memoria.
 * Implementan solo lo que usan los eventos de src/socket/salas.handlers.ts, para probar la lógica
 * (quién recibe qué, validaciones, errores) sin red ni base de datos.
 */
import { armarPagina } from "../src/repositories/paginacion";
import type { SalaGuardada } from "../src/repositories/rooms.repository";
import type { Mensaje, PaginaHistorial, UsuarioSocket } from "../src/socket/eventos";
import type { RepositorioSalas } from "../src/socket/salas.handlers";

type Listener = (...args: any[]) => unknown;

export class SocketFalso {
  rooms: Set<string>;
  data: { usuario: UsuarioSocket };
  recovered = false;
  /** Eventos que este cliente recibió del servidor: [nombre, datos]. */
  recibidos: [string, unknown][] = [];
  conectado = true;
  private listeners = new Map<string, Listener[]>();

  constructor(private io: IoFalso, public id: string, usuario: UsuarioSocket) {
    this.rooms = new Set([id]);
    this.data = { usuario };
  }

  on(evento: string, fn: Listener) {
    this.listeners.set(evento, [...(this.listeners.get(evento) ?? []), fn]);
    return this;
  }

  join(sala: string) {
    this.rooms.add(sala);
  }

  leave(sala: string) {
    this.rooms.delete(sala);
  }

  /** Emite a los demás de la sala (no a sí mismo), como socket.to(sala).emit. */
  to(sala: string) {
    return { emit: (evento: string, datos: unknown) => this.io.entregar(sala, evento, datos, this) };
  }

  emit(evento: string, datos: unknown) {
    this.recibidos.push([evento, datos]);
    return true;
  }

  disconnect() {
    void this.desconectar();
    return this;
  }

  /** Simula que el cliente emite un evento con callback y espera la respuesta (ack). */
  emitir<T = any>(evento: string, datos?: unknown): Promise<T> {
    const [fn] = this.listeners.get(evento) ?? [];
    if (!fn) throw new Error(`Sin manejador para ${evento}`);
    return new Promise<T>((resolve) => {
      void fn(datos, resolve);
    });
  }

  /** Cuántas veces recibió un evento, y los datos de la última. */
  ultimo(evento: string): unknown {
    return [...this.recibidos].reverse().find(([nombre]) => nombre === evento)?.[1];
  }

  async desconectar() {
    if (!this.conectado) return;
    for (const fn of this.listeners.get("disconnecting") ?? []) fn("transport close");
    this.conectado = false;
    this.rooms.clear();
    this.io.quitar(this);
    for (const fn of this.listeners.get("disconnect") ?? []) await fn("transport close");
  }
}

export class IoFalso {
  sockets: SocketFalso[] = [];
  private contador = 0;

  conectar(usuario: UsuarioSocket): SocketFalso {
    const socket = new SocketFalso(this, `socket-${++this.contador}`, usuario);
    this.sockets.push(socket);
    return socket;
  }

  quitar(socket: SocketFalso) {
    this.sockets = this.sockets.filter((s) => s !== socket);
  }

  entregar(sala: string, evento: string, datos: unknown, excepto?: SocketFalso) {
    for (const s of this.sockets) if (s !== excepto && s.rooms.has(sala)) s.emit(evento, datos);
  }

  to(sala: string) {
    return { emit: (evento: string, datos: unknown) => this.entregar(sala, evento, datos) };
  }

  in(sala: string) {
    return {
      fetchSockets: async () => this.sockets.filter((s) => s.rooms.has(sala)),
      socketsLeave: (salaQueDejan: string) => {
        for (const s of this.sockets) if (s.rooms.has(sala)) s.rooms.delete(salaQueDejan);
      },
    };
  }
}

/** Firestore en memoria con el mismo modelo: rooms/{id} y rooms/{id}/messages. */
export class RepositorioFalso implements RepositorioSalas {
  salas = new Map<string, SalaGuardada & { miembros: string[] }>();
  perfiles = new Set<string>();
  mensajes = new Map<string, Mensaje[]>();
  fallar = false;
  private reloj = Date.parse("2026-11-20T10:00:00.000Z");
  private siguienteId = 0;

  crearSala(id: string, nombre: string, anfitrionUid: string) {
    this.salas.set(id, { id, nombre, anfitrionUid, miembros: [anfitrionUid] });
    this.mensajes.set(id, []);
  }

  /** Borra la sala y sus mensajes, como DELETE /api/rooms/:id en backend-api. */
  borrarSala(id: string) {
    this.salas.delete(id);
    this.mensajes.delete(id);
  }

  /** Mete `cantidad` mensajes viejos, uno por segundo. */
  sembrar(salaId: string, cantidad: number) {
    for (let i = 1; i <= cantidad; i++) this.agregar(salaId, "uid-ana", "ana", `Mensaje ${i}`);
  }

  private agregar(salaId: string, autorUid: string, autorUsername: string, texto: string): Mensaje {
    this.reloj += 1000;
    const mensaje: Mensaje = {
      id: `m${++this.siguienteId}`,
      salaId,
      autorUid,
      autorUsername,
      texto,
      creadoEn: new Date(this.reloj).toISOString(),
    };
    this.mensajes.get(salaId)?.push(mensaje);
    return mensaje;
  }

  private revisar() {
    if (this.fallar) throw new Error("Firestore no responde");
  }

  async buscarSala(id: string) {
    this.revisar();
    const sala = this.salas.get(id);
    return sala ? { id: sala.id, nombre: sala.nombre, anfitrionUid: sala.anfitrionUid } : null;
  }

  async perfilExiste(uid: string) {
    this.revisar();
    return this.perfiles.has(uid);
  }

  async agregarMiembro(salaId: string, uid: string) {
    this.revisar();
    const sala = this.salas.get(salaId);
    if (sala && !sala.miembros.includes(uid)) sala.miembros.push(uid);
  }

  /** Igual que Firestore: orderBy(creadoEn, desc).limit(limite + 1) y luego armarPagina. */
  private pagina(lista: Mensaje[], limite: number): PaginaHistorial {
    const delMasNuevo = [...lista].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)).slice(0, limite + 1);
    const { items, hayMas } = armarPagina(delMasNuevo, limite);
    return { mensajes: items, hayMas };
  }

  async ultimosMensajes(salaId: string, limite = 50) {
    this.revisar();
    return this.pagina(this.mensajes.get(salaId) ?? [], limite);
  }

  async mensajesAnteriores(salaId: string, antesDe: Date, limite = 50) {
    this.revisar();
    const anteriores = (this.mensajes.get(salaId) ?? []).filter((m) => Date.parse(m.creadoEn) < antesDe.getTime());
    return this.pagina(anteriores, limite);
  }

  async guardarMensaje(salaId: string, autorUid: string, autorUsername: string, texto: string) {
    this.revisar();
    return this.agregar(salaId, autorUid, autorUsername, texto);
  }
}
