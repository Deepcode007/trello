import dotenv from "dotenv";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const searchDirs = [currentDir, process.cwd()];
    const candidatePaths = new Set<string>();

    for (const base of searchDirs) {
        let dir = base;
        while (dir && dir !== dirname(dir)) {
            candidatePaths.add(resolve(dir, ".env"));
            candidatePaths.add(resolve(dir, "packages/db/.env"));
            dir = dirname(dir);
        }
    }

    for (const envPath of candidatePaths) {
        if (existsSync(envPath)) {
            dotenv.config({ path: envPath, quiet: true });
            if (process.env.DATABASE_URL) {
                break;
            }
        }
    }
}

export const env = z.object({
    DATABASE_URL: z.url(),
    DATABASE_TEST_URL: z.url().optional(),
    RUN_DB_TESTS: z.string()
}).parse(process.env);

