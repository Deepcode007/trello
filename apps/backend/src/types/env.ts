import zod from "zod";

export const envSchema = zod.object({
    port: zod.string().refine(x => Number(x)),
    jwt_key: zod.string(),
    ws_port: zod.string().optional().refine(x => Number(x)),
    WS_INTERNAL_URL: zod.url().optional(),
    INTERNAL_BROADCAST_SECRET: zod.string().optional(),
    DATABASE_URL: zod.url().optional(),
    OUTBOX_RETRY_INTERVAL_MS: zod.string().optional(),
    OUTBOX_LEASE_MS: zod.string().optional()
})
