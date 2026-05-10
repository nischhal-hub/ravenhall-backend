import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const createPrismaClient = () =>
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn'] // ❌ removed "query"
        : ['error'],
  });

export const prisma = globalThis.__prisma ?? createPrismaClient();

// Prevent multiple instances in dev (hot reload fix)
if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
