# backend-realtime

Servidor de tiempo real del **Salón de Estudio Colaborativo en Tiempo Real** (Mini-proyecto 2). Usa Socket.IO para el chat y la presencia en las salas. En el Sprint 4 aquí vivirá también la señalización WebRTC (TS-03).

**Estado actual (Sprint 2 · TS-02):**
- Handshake autenticado: solo acepta conexiones con un ID token de Firebase válido.
- Unirse a una sala validando su ID (error si no existe).
- Mensajes de texto que llegan solo a la misma sala y se guardan en Firestore.
- Presencia: quién está conectado en cada sala.

## Producción

| Recurso | URL |
|---|---|
| Servidor de tiempo real (Render) | _(pegar aquí la URL del servicio en Render)_ |
| Health check | `/health` |

## Tecnologías

Node.js 20+, TypeScript, Express 5, Socket.IO 4, Firebase Admin SDK (Authentication y Firestore), Docker.

## Estructura del proyecto

```
src/
├── config/          Variables de entorno y conexión a Firebase (db y auth)
├── socket/
│   ├── eventos.ts         Contrato de eventos (tipos compartidos con el frontend)
│   ├── auth.ts            Handshake: verifica el ID token y carga el perfil
│   └── salas.handlers.ts  room:join, room:leave, message:send y presencia
├── repositories/    Acceso a Firestore (salas y mensajes)
└── index.ts         Express (/health) + Socket.IO sobre el mismo puerto
```

## Variables de entorno

Copia `.env.example` a `.env`. Las credenciales de Firebase son las **mismas** de `backend-api` (misma cuenta de servicio). Nunca se suben al repositorio.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PORT` | No | Puerto. Por defecto 4000 (Render lo define solo) |
| `NODE_ENV` | No | `development` o `production` |
| `CORS_ORIGINS` | No | Orígenes permitidos, separados por coma y sin barra final. En producción: la URL de Vercel |
| `FIREBASE_PROJECT_ID` | Sí | ID del proyecto de Firebase |
| `FIREBASE_CLIENT_EMAIL` | Sí | `client_email` de la cuenta de servicio |
| `FIREBASE_PRIVATE_KEY` | Sí | `private_key` de la cuenta de servicio, con los `\n` literales |

## Ejecución

```bash
npm install
npm run dev                  # desarrollo
npm run build && npm start   # producción
```

Con Docker:

```bash
docker build -t backend-realtime .
docker run -p 4000:4000 --env-file .env backend-realtime
```

## Conexión desde el frontend

```ts
import { io } from "socket.io-client";
import { auth } from "./firebase";

const socket = io(import.meta.env.VITE_REALTIME_URL, {
  // Se pide un token nuevo en cada intento de conexión o reconexión.
  auth: async (cb) => cb({ token: await auth.currentUser?.getIdToken() }),
});

socket.on("connect", () => {/* «Conectado» */});
socket.on("disconnect", () => {/* «Desconectado, reintentando…» (Socket.IO reintenta solo) */});
socket.on("connect_error", (err) => {
  // err.message: texto para mostrar · err.data?.code: UNAUTHORIZED | PROFILE_INCOMPLETE | SERVER_UNAVAILABLE
});
```

## Eventos de Socket.IO

Todas las respuestas (ack) tienen la forma `{ ok: true, data }` o `{ ok: false, error: { code, message } }`.

### Handshake

| Qué envía el cliente | Resultado |
|---|---|
| `auth: { token: <ID token> }` válido y con perfil | Conexión aceptada |
| Sin token, token inválido, expirado o de una cuenta eliminada | `connect_error` con `data.code = "UNAUTHORIZED"` |
| Cuenta de Google que aún no eligió username | `connect_error` con `data.code = "PROFILE_INCOMPLETE"` |
| Firebase no respondió | `connect_error` con `data.code = "SERVER_UNAVAILABLE"` |

### Cliente → servidor

| Evento | Datos | Respuesta (ack) | Errores |
|---|---|---|---|
| `room:join` | `{ roomId }` | `{ sala: { id, nombre, anfitrionUid, rol }, presentes: [usuario], historial: [mensaje] }` (últimos 50 mensajes) | `VALIDATION_ERROR` (ID mal escrito), `ROOM_NOT_FOUND` |
| `room:leave` | `{ roomId }` | `{ salaId }` | `NOT_IN_ROOM` |
| `message:send` | `{ roomId, texto }` | El mensaje guardado | `NOT_IN_ROOM`, `VALIDATION_ERROR` (vacío o más de 1000 caracteres), `ROOM_NOT_FOUND` |

### Servidor → clientes

| Evento | Datos | A quién llega |
|---|---|---|
| `message:new` | `{ id, salaId, autorUid, autorUsername, texto, creadoEn }` | Solo a los sockets de **esa** sala (incluido quien lo envió) |
| `presence:update` | `{ salaId, presentes: [{ uid, username, avatar }] }` | Solo a los sockets de esa sala, cuando alguien entra, sale o se desconecta |

### Reglas

- El ID de la sala se recorta y se pasa a mayúsculas; tiene las mismas reglas de `backend-api` (8 caracteres sin 0, O, 1, I, L).
- Un socket está en una sola sala a la vez: al unirse a otra, sale de la anterior.
- Al unirse, el usuario queda en `miembros` de la sala (lo usa la política de eliminar cuenta, US-05).
- **Aislamiento:** un mensaje solo se puede enviar a la sala en la que el socket está, y solo se emite a esa sala.
- Si la sala fue borrada, el mensaje no se guarda (no quedan mensajes huérfanos).

## Modelo en Firestore

| Colección | Documento | Campos |
|---|---|---|
| `rooms` | `{id}` | `id, nombre, anfitrionUid, miembros, creadoEn, actualizadoEn` (la crea `backend-api`) |
| `rooms/{id}/messages` | `{msgId}` | `autorUid, autorUsername, texto, creadoEn` |

## Despliegue

Render, como Web Service con **Docker**, desde la rama `main`:
- Variables de entorno en el panel de Render (en `FIREBASE_PRIVATE_KEY` el valor va sin comillas).
- Health check path: `/health`.
- `CORS_ORIGINS` con la URL de Vercel.
- El plan gratuito "duerme" el servicio: antes de una revisión abre `/health` para despertarlo.

## Flujo de trabajo

Una rama por historia (`feature/TS-02-socket-io`), commits que nombran la historia y un PR por historia con descripción y capturas. Nada se programa directo en `main`. Si se usa IA, se declara en el PR.
