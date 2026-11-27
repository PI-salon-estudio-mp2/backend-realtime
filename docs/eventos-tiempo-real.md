# Eventos del chat en tiempo real · backend-realtime

Servidor: **https://backend-realtime-s7sh.onrender.com** (Socket.IO 4). La API REST y su Swagger están en
https://backend-api-7xa7.onrender.com/docs/.

Este documento lista cada evento de Socket.IO: su **nombre**, los **datos que envía** y **quién lo recibe**.
Es el mismo contrato que usa el frontend (`frontend/docs/chat-tiempo-real.md` y `src/socket/eventos.ts`).

Todas las respuestas (ack) tienen la forma `{ ok: true, data }` o `{ ok: false, error: { code, message } }`.
`message` es un texto listo para mostrar al estudiante.

## 1. Conexión (handshake)

```ts
io("https://backend-realtime-s7sh.onrender.com", {
  auth: (cb) => cb({ token: "<ID token de Firebase>" }), // se pide uno vigente en cada (re)conexión
});
```

| Qué pasa | Resultado |
|---|---|
| Token válido de una cuenta con perfil | Conexión aceptada; el servidor guarda `uid`, `username` y `avatar` |
| Sin token, token inválido, expirado o de una cuenta eliminada | `connect_error` con `err.data.code = "UNAUTHORIZED"` |
| Cuenta de Google que aún no eligió nombre de usuario | `connect_error` con `err.data.code = "PROFILE_INCOMPLETE"` |
| Firebase no respondió | `connect_error` con `err.data.code = "SERVER_UNAVAILABLE"` |

## 2. Eventos que envía el cliente

| Evento | Datos que envía | Respuesta (ack) | Errores |
|---|---|---|---|
| `room:join` | `{ roomId }` | `{ sala: { id, nombre, anfitrionUid, rol }, presentes: [Usuario], historial: [Mensaje], hayMasHistorial }`. `rol` es `"administrador"` (anfitrión) o `"invitado"`. `historial` son los **últimos 50** mensajes, del más viejo al más nuevo | `VALIDATION_ERROR`, `ROOM_NOT_FOUND` |
| `room:leave` | `{ roomId }` | `{ salaId }` | `NOT_IN_ROOM` |
| `message:send` | `{ roomId, texto }` (1 a 1000 caracteres) | El `Mensaje` guardado en Firestore | `NOT_IN_ROOM`, `VALIDATION_ERROR`, `ROOM_NOT_FOUND` |
| `history:before` | `{ roomId, antesDe, limite }`. `antesDe`: fecha ISO del mensaje más viejo en pantalla. `limite`: 1 a 50 (si no viene, 50) | `{ mensajes: [Mensaje], hayMas }`: los anteriores a `antesDe`, del más viejo al más nuevo. `hayMas` indica si quedan más viejos | `NOT_IN_ROOM`, `VALIDATION_ERROR`, `SERVER_UNAVAILABLE` |
| `room:closed` | `{ roomId }`. Lo emite el anfitrión **después** de `DELETE /api/rooms/:id` | `{ salaId }` | `VALIDATION_ERROR`, `ROOM_STILL_EXISTS` (la sala todavía existe) |

## 3. Eventos que envía el servidor

| Evento | Datos que envía | Quién lo recibe | Cuándo |
|---|---|---|---|
| `message:new` | `Mensaje` | Solo los sockets que están en **esa** sala (incluido quien lo escribió) | Cada vez que se guarda un mensaje |
| `presence:update` | `{ salaId, presentes: [Usuario] }` | Solo los sockets de esa sala | Alguien entra, sale, se desconecta o se reconecta |
| `room:deleted` | `{ salaId }` | Todos los sockets que estaban en esa sala; después quedan fuera de ella | El anfitrión eliminó la sala (`room:closed`), o alguien intentó escribir en una sala que ya no existe |

**Tipos**

```ts
Usuario = { uid: string; username: string; avatar: string }
Mensaje = { id: string; salaId: string; autorUid: string | null; autorUsername: string; texto: string; creadoEn: string /* ISO */ }
```

## 4. Reglas

- **Aislamiento por sala:** un socket solo puede escribir o leer historial de la sala en la que entró con
  `room:join`, y `message:new` se emite solo a esa sala. Un socket está en una sola sala a la vez.
- **Persistencia:** cada mensaje lo guarda el **servidor** en `rooms/{id}/messages` (el navegador nunca escribe
  en Firestore). No se guardan mensajes de salas borradas ni de cuentas eliminadas.
- **Historial por partes:** al entrar llegan los últimos 50; con `history:before` se piden de 50 en 50 hacia
  atrás. En Firestore: `where(creadoEn < antesDe)`, `orderBy(creadoEn, desc)`, `limit(limite + 1)`; si llega
  el de sobra, `hayMas = true`.
- **Permisos de sala:** editar (`PATCH /api/rooms/:id`) y eliminar (`DELETE /api/rooms/:id`) los hace la API
  y solo para el anfitrión; cualquier otro recibe **403 FORBIDDEN**. `room:closed` solo avisa si la sala ya
  **no existe** en Firestore, así que nadie puede cerrar una sala ajena que sigue viva.
- **Reconexión:** el cliente de Socket.IO reintenta solo (1 s, 2 s, … hasta 8 s) y, al volver, el frontend
  emite otra vez `room:join`; el servidor lo devuelve a la sala con el historial actualizado y avisa la
  presencia. Si la caída dura menos de 2 minutos, además se recuperan las salas del socket y los mensajes
  que se perdió (`connectionStateRecovery`). El token se vuelve a verificar en cada reconexión.

## 5. Códigos de error

| Código | Significado |
|---|---|
| `UNAUTHORIZED` | Sesión no válida o expirada |
| `PROFILE_INCOMPLETE` | Falta elegir el nombre de usuario |
| `VALIDATION_ERROR` | Datos mal escritos (ID de sala, mensaje vacío o largo, fecha o límite inválidos) |
| `ROOM_NOT_FOUND` | La sala no existe (o se eliminó) |
| `NOT_IN_ROOM` | El socket no está en esa sala |
| `ROOM_STILL_EXISTS` | Se intentó cerrar una sala que todavía existe |
| `SERVER_UNAVAILABLE` | Firestore no respondió; se puede reintentar |
