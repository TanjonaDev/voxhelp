import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db/client.js";
import { verifyJwt } from "../middleware/auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/signup", async (request, reply) => {
    const { email, password, name, orgName } = request.body as {
      email: string;
      password: string;
      name: string;
      orgName: string;
    };

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "Email already in use" });

    const hash = await bcrypt.hash(password, 10);
    const org = await prisma.organization.create({ data: { name: orgName } });
    const user = await prisma.user.create({
      data: { email, name, password: hash, orgId: org.id, role: "ADMIN" },
    });

    const token = jwt.sign(
      { userId: user.id, orgId: org.id, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    return reply.code(201).send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId },
    });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.code(401).send({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return reply.code(401).send({ error: "Invalid credentials" });

    const token = jwt.sign(
      { userId: user.id, orgId: user.orgId, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId } };
  });

  app.get("/api/auth/me", { preHandler: [verifyJwt] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true, name: true, role: true, orgId: true, createdAt: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return user;
  });
}
