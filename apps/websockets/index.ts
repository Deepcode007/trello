import { env } from "./src/env";
import { createWebSocketServer } from "./src/server";

const port = Number(env.ws_port);
const server = createWebSocketServer({ port, jwtSecret: env.jwt_key });
console.log(`WebSocket server listening on port ${server.port}`);
