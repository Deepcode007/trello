import { envSchema } from "./src/types/env";
import { createWebSocketServer } from "./src/server";
import { wsBroadcaster, WebSocketBroadcaster } from "./src/services/broadcaster";

const result = envSchema.safeParse(process.env);
if (!result.success) {
    console.error("WS Env Problem:", result.error.format());
    process.exit(1);
}

export const WS_env = result.data;
const port = Number(WS_env.ws_port);
const jwtSecret = WS_env.jwt_key;

export let server: ReturnType<typeof createWebSocketServer> | null = null;

export function getOrCreateServer(opts?: { port?: number; jwtSecret?: string }) {
    if (!server) {
        server = createWebSocketServer({
            port: opts?.port ?? port,
            jwtSecret: opts?.jwtSecret ?? jwtSecret
        });
    }
    return server;
}

if (import.meta.main) {
    server = getOrCreateServer();
    console.log(`WebSocket server listening on port ${server.port}`);

    // Optional: In single-process dual-server mode, also boot Express
    if (process.env.START_EXPRESS === "true" || process.env.DUAL_SERVER === "true") {
        console.log("Starting Express in the same process...");
        await import("backend");
    }
}

export { createWebSocketServer, wsBroadcaster, WebSocketBroadcaster };
export * from "./src/types/events";
export * from "./src/auth/authUpgrade";
export * from "./src/server";
