/**
 * Pruebas de los eventos de la sala (S3-C06): chat por sala, historial por partes,
 * eliminación con participantes conectados y reconexión. Se ejecutan con: npm test
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { armarPagina } from "../src/repositories/paginacion";
import type { Mensaje, PaginaHistorial, SalaUnida } from "../src/socket/eventos";
import { registrarEventosDeSala, ServidorApp } from "../src/socket/salas.handlers";
import { IoFalso, RepositorioFalso, SocketFalso } from "./fakes";

type Ok<T> = { ok: true; data: T };
type Fallo = { ok: false; error: { code: string; message: string } };

const SALA = "K7P2QX9M";
const OTRA_SALA = "ABCDEFGH";
const ANA = { uid: "uid-ana", username: "ana", avatar: "azul" }; // anfitriona
const BETO = { uid: "uid-beto", username: "beto", avatar: "verde" };
const CAMI = { uid: "uid-cami", username: "cami", avatar: "ocre" };

let io: IoFalso;
let repo: RepositorioFalso;

function conectar(usuario: typeof ANA): SocketFalso {
  const socket = io.conectar(usuario);
  registrarEventosDeSala(io as unknown as ServidorApp, socket as never, repo);
  return socket;
}

async function entrar(socket: SocketFalso, sala = SALA) {
  const r = await socket.emitir<Ok<SalaUnida> | Fallo>("room:join", { roomId: sala });
  assert.equal(r.ok, true, `no pudo entrar: ${JSON.stringify(r)}`);
  return (r as Ok<SalaUnida>).data;
}

beforeEach(() => {
  io = new IoFalso();
  repo = new RepositorioFalso();
  for (const u of [ANA, BETO, CAMI]) repo.perfiles.add(u.uid);
  repo.crearSala(SALA, "Cálculo Integral", ANA.uid);
  repo.crearSala(OTRA_SALA, "Física", CAMI.uid);
});

describe("Chat por sala", () => {
  it("el mensaje llega solo a los participantes de la misma sala y queda guardado", async () => {
    const ana = conectar(ANA);
    const beto = conectar(BETO);
    const cami = conectar(CAMI);
    await entrar(ana);
    await entrar(beto);
    await entrar(cami, OTRA_SALA);

    const r = await ana.emitir<Ok<Mensaje>>("message:send", { roomId: SALA, texto: "  Hola grupo  " });
    assert.equal(r.ok, true);
    assert.equal(r.data.texto, "Hola grupo");
    assert.deepEqual(beto.ultimo("message:new"), r.data);
    assert.deepEqual(ana.ultimo("message:new"), r.data);
    assert.equal(cami.ultimo("message:new"), undefined, "no debe llegar a otra sala");
    assert.equal(repo.mensajes.get(SALA)?.length, 1, "se guarda en Firestore");
    assert.equal(repo.mensajes.get(OTRA_SALA)?.length, 0);
  });

  it("no deja escribir en una sala en la que no se ha entrado", async () => {
    const beto = conectar(BETO);
    const r = await beto.emitir<Fallo>("message:send", { roomId: SALA, texto: "hola" });
    assert.equal(r.error.code, "NOT_IN_ROOM");
    assert.equal(repo.mensajes.get(SALA)?.length, 0);
  });

  it("rechaza mensajes vacíos o de más de 1000 caracteres", async () => {
    const ana = conectar(ANA);
    await entrar(ana);
    assert.equal((await ana.emitir<Fallo>("message:send", { roomId: SALA, texto: "   " })).error.code, "VALIDATION_ERROR");
    assert.equal(
      (await ana.emitir<Fallo>("message:send", { roomId: SALA, texto: "a".repeat(1001) })).error.code,
      "VALIDATION_ERROR"
    );
  });
});

describe("Historial (US-11)", () => {
  it("al entrar trae los últimos 50, del más viejo al más nuevo, y avisa si hay más", async () => {
    repo.sembrar(SALA, 120);
    const datos = await entrar(conectar(BETO));
    assert.equal(datos.historial.length, 50);
    assert.equal(datos.historial[0].texto, "Mensaje 71");
    assert.equal(datos.historial[49].texto, "Mensaje 120");
    assert.equal(datos.hayMasHistorial, true);
  });

  it("history:before entrega las páginas anteriores hasta el primer mensaje", async () => {
    repo.sembrar(SALA, 120);
    const beto = conectar(BETO);
    const { historial } = await entrar(beto);

    const p1 = await beto.emitir<Ok<PaginaHistorial>>("history:before", {
      roomId: SALA,
      antesDe: historial[0].creadoEn,
      limite: 50,
    });
    assert.equal(p1.ok, true);
    assert.equal(p1.data.mensajes.length, 50);
    assert.equal(p1.data.mensajes[0].texto, "Mensaje 21");
    assert.equal(p1.data.mensajes[49].texto, "Mensaje 70");
    assert.equal(p1.data.hayMas, true);

    const p2 = await beto.emitir<Ok<PaginaHistorial>>("history:before", {
      roomId: SALA,
      antesDe: p1.data.mensajes[0].creadoEn,
      limite: 50,
    });
    assert.equal(p2.data.mensajes.length, 20);
    assert.equal(p2.data.mensajes[0].texto, "Mensaje 1");
    assert.equal(p2.data.hayMas, false);
  });

  it("en una sala con pocos mensajes, hayMasHistorial es false", async () => {
    repo.sembrar(SALA, 50);
    const datos = await entrar(conectar(BETO));
    assert.equal(datos.historial.length, 50);
    assert.equal(datos.hayMasHistorial, false);
  });

  it("history:before exige estar en la sala y datos válidos", async () => {
    repo.sembrar(SALA, 10);
    const cami = conectar(CAMI);
    await entrar(cami, OTRA_SALA);
    const antesDe = new Date().toISOString();
    const fuera = await cami.emitir<Fallo>("history:before", { roomId: SALA, antesDe, limite: 50 });
    assert.equal(fuera.error.code, "NOT_IN_ROOM", "no puede leer mensajes de otra sala");

    const beto = conectar(BETO);
    await entrar(beto);
    assert.equal((await beto.emitir<Fallo>("history:before", { roomId: SALA, antesDe: "ayer" })).error.code, "VALIDATION_ERROR");
    assert.equal(
      (await beto.emitir<Fallo>("history:before", { roomId: SALA, antesDe, limite: 500 })).error.code,
      "VALIDATION_ERROR"
    );
    const sinLimite = await beto.emitir<Ok<PaginaHistorial>>("history:before", { roomId: SALA, antesDe });
    assert.equal(sinLimite.data.mensajes.length, 10, "sin límite usa 50");
  });

  it("armarPagina recorta, invierte y calcula hayMas", () => {
    assert.deepEqual(armarPagina([5, 4, 3, 2], 3), { items: [3, 4, 5], hayMas: true });
    assert.deepEqual(armarPagina([2, 1], 3), { items: [1, 2], hayMas: false });
    assert.deepEqual(armarPagina([], 50), { items: [], hayMas: false });
  });
});

describe("Eliminar la sala con participantes conectados (US-07)", () => {
  it("room:closed avisa a todos los de la sala y los saca", async () => {
    const ana = conectar(ANA);
    const beto = conectar(BETO);
    const cami = conectar(CAMI);
    await entrar(ana);
    await entrar(beto);
    await entrar(cami, OTRA_SALA);

    repo.borrarSala(SALA); // DELETE /api/rooms/:id (solo el anfitrión; si no, 403)
    const r = await ana.emitir<Ok<{ salaId: string }>>("room:closed", { roomId: SALA });

    assert.deepEqual(r, { ok: true, data: { salaId: SALA } });
    assert.deepEqual(beto.ultimo("room:deleted"), { salaId: SALA });
    assert.equal(beto.rooms.has(SALA), false, "el invitado queda fuera de la sala");
    assert.equal(ana.rooms.has(SALA), false);
    assert.equal(cami.ultimo("room:deleted"), undefined, "otra sala no se entera");
    assert.equal(cami.rooms.has(OTRA_SALA), true);
  });

  it("no se puede cerrar una sala que sigue existiendo", async () => {
    const beto = conectar(BETO);
    await entrar(beto);
    const intruso = conectar(CAMI);
    const r = await intruso.emitir<Fallo>("room:closed", { roomId: SALA });
    assert.equal(r.error.code, "ROOM_STILL_EXISTS");
    assert.equal(beto.ultimo("room:deleted"), undefined);
    assert.equal(beto.rooms.has(SALA), true);
  });

  it("si nadie avisó, el primer mensaje a la sala borrada avisa a todos", async () => {
    const ana = conectar(ANA);
    const beto = conectar(BETO);
    await entrar(ana);
    await entrar(beto);
    repo.borrarSala(SALA);

    const r = await beto.emitir<Fallo>("message:send", { roomId: SALA, texto: "¿hola?" });
    assert.equal(r.error.code, "ROOM_NOT_FOUND");
    assert.deepEqual(ana.ultimo("room:deleted"), { salaId: SALA });
    assert.equal(ana.rooms.has(SALA), false);
  });

  it("room:closed con un ID mal escrito responde VALIDATION_ERROR", async () => {
    const r = await conectar(ANA).emitir<Fallo>("room:closed", { roomId: "123" });
    assert.equal(r.error.code, "VALIDATION_ERROR");
  });
});

describe("Reconexión", () => {
  it("al reconectarse, room:join lo devuelve a su sala con el historial y vuelve a recibir mensajes", async () => {
    const ana = conectar(ANA);
    let beto = conectar(BETO);
    await entrar(ana);
    await entrar(beto);

    await beto.desconectar(); // se cayó la conexión
    const presencia = ana.ultimo("presence:update") as { presentes: { uid: string }[] };
    assert.deepEqual(presencia.presentes.map((p) => p.uid), [ANA.uid], "los demás ven que salió");

    await ana.emitir("message:send", { roomId: SALA, texto: "¿Siguen ahí?" });

    beto = conectar(BETO); // el cliente de Socket.IO reconecta y el frontend emite room:join
    const datos = await entrar(beto);
    assert.equal(datos.historial.at(-1)?.texto, "¿Siguen ahí?", "recupera lo que se perdió");
    const presencia2 = ana.ultimo("presence:update") as { presentes: { uid: string }[] };
    assert.deepEqual(presencia2.presentes.map((p) => p.uid).sort(), [ANA.uid, BETO.uid]);

    await ana.emitir("message:send", { roomId: SALA, texto: "Bienvenido de vuelta" });
    assert.equal((beto.ultimo("message:new") as Mensaje).texto, "Bienvenido de vuelta");
  });
});

describe("Errores de Firestore", () => {
  it("si la base de datos falla, responde SERVER_UNAVAILABLE sin tumbar el servidor", async () => {
    const beto = conectar(BETO);
    await entrar(beto);
    repo.fallar = true;
    const r = await beto.emitir<Fallo>("history:before", { roomId: SALA, antesDe: new Date().toISOString() });
    assert.equal(r.error.code, "SERVER_UNAVAILABLE");
    const r2 = await beto.emitir<Fallo>("room:closed", { roomId: SALA });
    assert.equal(r2.error.code, "SERVER_UNAVAILABLE");
  });
});
