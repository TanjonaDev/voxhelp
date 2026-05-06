import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";

interface JwtPayload {
  userId: string;
  orgId: string;
  role: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

export async function verifyJwt(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    request.user = payload;
  } catch {
    reply.code(401).send({ error: "Invalid token" });
  }
}
