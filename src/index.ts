import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import { env } from "./config/env";
import { autenticarSocket } from "./socket/auth";
import { registrarEventosDeSala, ServidorApp } from "./socket/salas.handlers";

const app = express();
app.disable("x-powered-by");

app.get("/", (_req, res) => {
  res.json({
    service: "backend-realtime",
    status: "ok",
    descripcion: "Servidor Socket.IO del Salón de Estudio (TS-02). Solo acepta conexiones con un ID token de Firebase.",
    eventos: {
      cliente: ["room:join", "room:leave", "message:send"],
      servidor: ["message:new", "presence:update"],
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "backend-realtime" });
});

const httpServer = createServer(app);

const io: ServidorApp = new Server(httpServer, {
  cors: { origin: env.corsOrigins, methods: ["GET", "POST"] },
});

// Handshake: sin ID token válido no hay conexión.
io.use(autenticarSocket);

io.on("connection", (socket) => {
  registrarEventosDeSala(io, socket);
});

httpServer.listen(env.port, () => {
  console.log(`backend-realtime escuchando en el puerto ${env.port}`);
});
