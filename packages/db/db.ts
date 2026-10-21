import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { env } from "./env";

const test = (env.RUN_DB_TESTS === "1" ? true : false);

const adapter = new PrismaPg({ connectionString: (test ? env.DATABASE_TEST_URL : env.DATABASE_URL) });

export const prisma = new PrismaClient({ adapter });
