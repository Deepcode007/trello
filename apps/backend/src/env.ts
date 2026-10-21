import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { envSchema } from "./types/env.ts";

if (!process.env.jwt_key) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const searchDirs = [process.cwd(), currentDir];
    for (const base of searchDirs) {
        let dir = base;
        while (dir && dir !== dirname(dir)) {
            const envPath = resolve(dir, ".env");
            if (existsSync(envPath)) {
                if (typeof process.loadEnvFile === "function") {
                    process.loadEnvFile(envPath);
                }
                break;
            }
            dir = dirname(dir);
        }
        if (process.env.jwt_key) break;
    }
}

const result = envSchema.safeParse(process.env);
if (!result.success)
{
    console.error("Env Problem:", result.error);
    process.exit(1);
}
const env = result.data;
export { env };
