# backend-realtime

Servidor de tiempo real del Salón de Estudio Colaborativo. Aquí vivirán Socket.IO (chat y presencia) y la señalización WebRTC.

**Estado actual (Sprint 0):** esqueleto del proyecto, con su Dockerfile y un endpoint de salud. La lógica de tiempo real se implementa desde el Sprint 2 (TS-02).

## Requisitos
- Node.js 20 o superior
- Docker (opcional)

## Variables de entorno
Copia `.env.example` a `.env`.

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor. Por defecto 4000 |

## Ejecución
```bash
npm install
npm run dev                  # desarrollo
npm run build && npm start   # producción
```

Con Docker:
```bash
docker build -t backend-realtime .
docker run -p 4000:4000 backend-realtime
```

## Endpoints
- `GET /health` devuelve `{ "status": "ok", "service": "backend-realtime" }`

## Flujo de trabajo
Una rama por historia, commits que nombran la historia y un PR por historia con descripción y capturas. Nada se programa directo en `main`. Si se usa IA, se declara en el PR.