declare global
{
    var TEST_BASE_URL: string;
}

globalThis.TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";