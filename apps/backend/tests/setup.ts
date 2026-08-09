import type { Subprocess } from "bun";
import { Client } from "pg";
import { join } from "path";
import { beforeAll, afterAll } from "bun:test";

let serverProcess: Subprocess;
const TEST_DB_NAME = "trello_test", PG_BASE_URL = "postgresql://deep@localhost:5432";

declare global
{
    var TEST_BASE_URL: string;
}

beforeAll(async () =>
{
    console.log(`\n🐘 Creating temporary database: ${TEST_DB_NAME}...`);

    const pgClient = new Client({ connectionString: `${PG_BASE_URL}/postgres` });
    await pgClient.connect();
    await pgClient.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}";`);
    await pgClient.query(`CREATE DATABASE "${TEST_DB_NAME}";`);
    await pgClient.end();

    const testDbUrl = `${PG_BASE_URL}/${TEST_DB_NAME}`;
    process.env.DATABASE_URL = testDbUrl;

    console.log("📜 Pushing Prisma schema to test DB...");
    Bun.spawnSync([process.execPath, "x", "prisma", "db", "push", "--skip-generate"], {
        cwd: join(import.meta.dir, "../../../packages/db"),
        env: { ...process.env, DATABASE_URL: testDbUrl },
        stdout: "ignore",
    });

    console.log("🚀 Spawning backend server...");
    serverProcess = Bun.spawn(["bun", "run", "dev"], {
        cwd: "../",
        env: {
            ...process.env,
            DATABASE_URL: testDbUrl,
            NODE_ENV: "test"
        },
        stdout: "inherit",
        stderr: "inherit",
    });

    globalThis.TEST_BASE_URL = "http://localhost:3000";

    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log("🚀 Starting integration tests...");
});


afterAll(async () =>
{
    // Step 1: Kill the backend process first so it releases database connections
    console.log("\n🧹 Killing backend process...");
    serverProcess.kill();

    // Step 2: Reconnect to default 'postgres' DB and DROP the temporary test DB
    console.log(`🗑️ Dropping temporary database: ${TEST_DB_NAME}...`);
    const pgClient = new Client({ connectionString: `${PG_BASE_URL}/postgres` });
    await pgClient.connect();

    // Force close any open active connections to the test DB before dropping it
    await pgClient.query(`
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = '${TEST_DB_NAME}'
      AND pid <> pg_backend_pid();
  `);

    await pgClient.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}";`);
    await pgClient.end();
    console.log("✨ Cleanup complete!");
});
