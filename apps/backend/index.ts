import { wsBroadcaster } from "./src/services/broadcaster.ts";
import express from "express";

import { envSchema } from "./src/types/env.ts";

export const app = express();
app.use(express.json());

let result = envSchema.safeParse(process.env);
if (!result.success)
{
    console.log("Env Problem");
    process.exit(1);
}
export const env = result.data;
const port = env.port;

await import("./src/routes/routes.ts");

const server = app.listen(port, () =>
{
    console.log(port, " listening");
    wsBroadcaster.startOutboxWorker();
});

let shutdownPromise: Promise<void> | null = null;
const shutdown = () =>
{
    if (shutdownPromise) return;
    shutdownPromise = (async () =>
    {
        await wsBroadcaster.stopOutboxWorker();
        await new Promise<void>((resolve, reject) =>
        {
            server.close(error => error ? reject(error) : resolve());
        });
    })().catch(error =>
    {
        console.error("Backend shutdown failed:", error);
        process.exitCode = 1;
    });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
