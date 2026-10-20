import { wsBroadcaster } from "./src/services/broadcaster.ts";
import express from "express";
import cors from "cors";

import { env } from "./src/env.ts";

export const app = express();
app.use(express.json());
app.use(cors());

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
