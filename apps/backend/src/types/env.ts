import zod from "zod";

export const envSchema = zod.object({
    port: zod.string().refine(x=> Number(x)),
    jwt_key: zod.string()
})