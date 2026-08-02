import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerRoutes } from "../../routes.js";

export interface TestHttpServer {
  port: number;
  close: () => Promise<void>;
}

export async function createTestHttpServer(): Promise<TestHttpServer> {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  registerRoutes(app);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };

  return {
    port: address.port,
    close: () => app.close(),
  };
}
