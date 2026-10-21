import dotenv from "dotenv";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dbEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), ".env");
dotenv.config({ path: dbEnvPath, quiet: true });

export const env = z.object({
    DATABASE_URL: z.url(),
    DATABASE_TEST_URL: z.url().optional(),
    RUN_DB_TESTS: z.string().optional()
}).parse(process.env);
