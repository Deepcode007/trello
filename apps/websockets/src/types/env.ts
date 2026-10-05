import zod from "zod";

export const envSchema = zod.object({
    ws_port: zod.string().refine(x=> Number(x))
})