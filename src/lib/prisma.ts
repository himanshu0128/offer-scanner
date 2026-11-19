import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Ensure cached Prisma instance has the latest schema models (e.g. after `prisma generate` during `next dev`)
const existingClient = globalForPrisma.prisma;
const hasLatestModels = existingClient && 'user' in existingClient;

export const prisma =
  hasLatestModels && existingClient
    ? existingClient
    : new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

