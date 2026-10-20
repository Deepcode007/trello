import { envSchema } from "./types/env.ts";

const result = envSchema.safeParse(process.env);
if (!result.success)
{
    console.error("Env Problem:", result.error);
    process.exit(1);
}
const env = result.data;
export { env };
