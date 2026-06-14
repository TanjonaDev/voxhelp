import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { Session } from "../../session.js";

export interface TestServer {
  port: number;
  close: () => Promise<void>;
}

export async function createTestServer(): Promise<TestServer> {
  const app = Fastify({ logger: false });

  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    new Session(socket);
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };

  return {
    port: address.port,
    close: () => app.close(),
  };
}
