import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Use a Postgres URL (Neon, Vercel Postgres, etc.).",
    );
  }

  if (url.startsWith("file:") || url.includes("mode=memory")) {
    throw new Error(
      "SQLite file URLs are not supported in this build. Set DATABASE_URL to a Postgres connection string (Neon free tier works for local + Vercel).",
    );
  }

  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString: url,
      // Serverless-friendly: don't keep idle clients forever
      max: 10,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });

  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
