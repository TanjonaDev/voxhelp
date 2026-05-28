import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Session } from "./session.js";

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(websocket);

  app.get("/health", async () => ({ status: "ok", timestamp: Date.now() }));

  app.get("/ws", { websocket: true }, (socket) => {
    console.log("[Server] New WebSocket connection");
    new Session(socket);
  });

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`\n🚀 VoxHelp backend on http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}/ws\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
