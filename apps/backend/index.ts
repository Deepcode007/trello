import express from "express";

import {envSchema} from "./src/types/env.ts";

export const app = express();
app.use(express.json());

let result = envSchema.safeParse(process.env);
if (!result.success)
{
    console.log("Env Problem");
    process.exit(1);
}

const port = result.data.port;

app.listen(port, () => { console.log(port, " listening"); });
