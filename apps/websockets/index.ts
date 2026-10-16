import zod from "zod";
import { envSchema } from "./src/types/env";
import { createWebSocketServer } from "./src/server";

const result = envSchema.safeParse(process.env);
if (!result.success)
{
    console.error("WS Env Problem:", zod.treeifyError(result.error));
    process.exit(1);
}

const port = Number(result.data.ws_port);
const server = createWebSocketServer({ port, jwtSecret: result.data.jwt_key });
console.log(`WebSocket server listening on port ${server.port}`);
