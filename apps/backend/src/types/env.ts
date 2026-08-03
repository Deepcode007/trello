import zod from "zod";

export const envSchema = zod.object({
    port: zod.number(),
    jwt_key: zod.string()
})