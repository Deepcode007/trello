import zod from "zod";
import { envSchema } from "./types/env";

const result = envSchema.safeParse(process.env);
if (!result.success)
{
    console.error("WS Env Problem:", zod.treeifyError(result.error));
    process.exit(1);
}

export const env = result.data;
