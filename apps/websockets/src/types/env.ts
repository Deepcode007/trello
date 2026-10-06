import zod from "zod";

export const envSchema = zod.object({
    ws_port: zod.string().default("3001").refine(x => !isNaN(Number(x)), { message: "ws_port must be a valid number" }),
    jwt_key: zod.string(),
    port: zod.string().optional()
});

export type WsEnv = zod.infer<typeof envSchema>;