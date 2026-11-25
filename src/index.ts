import { createServer } from "node:http";
import express from "express";
import { env } from "./config/env";
import * as repositorioFirestore from "./repositories/rooms.repository";
import { autenticarSocket } from "./socket/auth";
import { crearServidorSocket } from "./socket/servidor";

const app = express();
app.disable("x-powered-by");

app.get("/", (_req, res) => {
  res.json({
    service: "backend-realtime",
    status: "ok",
    descripcion: "Servidor Socket.IO del Salón de Estudio. Solo acepta conexiones con un ID token de Firebase.",
    documentacion: "https://github.com/PI-salon-estudio-mp2/backend-realtime/blob/main/docs/eventos-tiempo-real.md",
    eventos: {
      cliente: ["room:join", "room:leave", "message:send", "history:before", "room:closed"],
      servidor: ["message:new", "presence:update", "room:deleted"],
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "backend-realtime" });
});

const httpServer = createServer(app);

crearServidorSocket(httpServer, {
  corsOrigins: env.corsOrigins,
  autenticar: autenticarSocket,
  repo: repositorioFirestore,
});

httpServer.listen(env.port, () => {
  console.log(`backend-realtime escuchando en el puerto ${env.port}`);
});
