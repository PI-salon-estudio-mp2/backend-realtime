import express from "express";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "backend-realtime" });
});

app.listen(port, () => {
  console.log(`backend-realtime escuchando en el puerto ${port}`);
});