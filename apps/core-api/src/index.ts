import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { interviewRoutes } from "./routes/interviews.js";

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(websocket);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(interviewRoutes);

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`\n🚀 VoxHelp core-api running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
