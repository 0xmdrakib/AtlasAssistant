import { PrismaClient } from "@prisma/client";
import { runtimeDatabaseUrl } from "@/lib/database-url";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const url = runtimeDatabaseUrl(process.env.DATABASE_URL);
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["error"], ...(url ? { datasources: { db: { url } } } : {}) });
globalForPrisma.prisma = prisma;
