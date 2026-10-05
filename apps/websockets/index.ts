import { envSchema } from "./src/types/env";

let result = envSchema.safeParse(process.env);
if (!result.success)
{
    console.log("WS Env Problem");
    process.exit(1);
}

export const WS_env = result.data;
const port = WS_env.ws_port;

const server = Bun.serve({
    port: port,
    fetch(req, server)
    {
        if (server.upgrade(req)) return;
        return new Response("WebSocket only", { status: 426 });
    },
    websocket: {
        message(ws, message)
        {
            ws.publish("topic", message.toString());
        },
        open(ws)
        {
            ws.subscribe("topic");
            server.publish("topic", "someone joined");
        },
        close(ws)
        {
            ws.unsubscribe("topic");
            server.publish("topic", "someone left");
        }
    }
})
