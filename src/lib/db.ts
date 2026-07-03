// Prisma klient singletoni. Next.js dev rejimida hot-reload har safar modulni
// qayta yuklaydi — globalThis'da saqlash ulanishlar ko'payib ketishining oldini oladi.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
