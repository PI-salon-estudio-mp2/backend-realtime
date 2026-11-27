# backend-realtime

Servidor de tiempo real del **Salón de Estudio Colaborativo en Tiempo Real** (Mini-proyecto 2). Usa Socket.IO para el chat y la presencia en las salas. En el Sprint 4 aquí vivirá también la señalización WebRTC (TS-03).

**Estado actual (Sprint 3):**
- Handshake autenticado: solo acepta conexiones con un ID token de Firebase válido (TS-02).
- Unirse a una sala validando su ID (error si no existe).
- Mensajes de texto que llegan solo a la misma sala y se guardan en Firestore desde el servidor.
- Historial por partes: los últimos 50 al entrar y `history:before` para los anteriores (US-11).
- Aviso `room:deleted` a los conectados cuando el anfitrión elimina la sala (US-07).
- Reconexión: vuelve a la sala al reconectarse y recupera lo que se perdió.
- Presencia: quién está conectado en cada sala.

📄 **Documentación de todos los eventos:** [docs/eventos-tiempo-real.md](docs/eventos-tiempo-real.md)

## Producción

| Recurso | URL |
|---|---|
| Servidor de tiempo real (Render) | https://backend-realtime-s7sh.onrender.com/ |
| Health check | https://backend-realtime-s7sh.onrender.com/health |

## Tecnologías

Node.js 20+, TypeScript, Express 5, Socket.IO 4, Firebase Admin SDK (Authentication y Firestore), Docker.

## Estructura del proyecto

```
src/
├── config/          Variables de entorno y conexión a Firebase (db y auth)
├── socket/
│   ├── eventos.ts         Contrato de eventos (tipos compartidos con el frontend)
│   ├── auth.ts            Handshake: verifica el ID token y carga el perfil
│   ├── servidor.ts        Crea Socket.IO (CORS, reconexión) y registra los eventos
│   └── salas.handlers.ts  room:join, room:leave, message:send, history:before, room:closed y presencia
├── repositories/    Acceso a Firestore (salas, mensajes e historial por páginas)
└── index.ts         Express (/health) + Socket.IO sobre el mismo puerto
tests/               Pruebas de los eventos con un Socket.IO y un Firestore en memoria (npm test)
docs/                Documentación de los eventos
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
npm test                     # pruebas de los eventos (no necesitan Firebase ni internet)
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

El detalle completo (datos, respuestas, errores y quién recibe cada evento) está en
**[docs/eventos-tiempo-real.md](docs/eventos-tiempo-real.md)**. Resumen:

| Evento | Dirección | Para qué |
|---|---|---|
| `room:join` | cliente → servidor | Entrar a la sala; devuelve la sala, los presentes, los últimos 50 mensajes y `hayMasHistorial` |
| `room:leave` | cliente → servidor | Salir de la sala |
| `message:send` | cliente → servidor | Enviar un mensaje (se guarda en Firestore) |
| `history:before` | cliente → servidor | Pedir los 50 mensajes anteriores (US-11) |
| `room:closed` | cliente → servidor | El anfitrión avisa que ya eliminó la sala (US-07) |
| `message:new` | servidor → sala | Mensaje nuevo, solo a los de esa sala |
| `presence:update` | servidor → sala | Quién está conectado |
| `room:deleted` | servidor → sala | La sala se eliminó; todos quedan fuera |

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

Una rama por historia (`feature/S3-chat-historial-y-eliminar-sala`), commits que nombran la historia y un PR por historia con descripción y capturas. Nada se programa directo en `main`. Si se usa IA, se declara en el PR.
