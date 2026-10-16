import { PrismaClient } from "@prisma/client";
import { isCrmShowcase } from "./showcase-mode";
import { createShowcaseClient } from "./showcase-db";

// Next dev reloads modules; without this the connection pool leaks on every hot reload.
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = isCrmShowcase()
  ? createShowcaseClient() as unknown as PrismaClient
  : g.prisma ?? new PrismaClient();
if (!isCrmShowcase() && process.env.NODE_ENV !== "production") g.prisma = prisma;
