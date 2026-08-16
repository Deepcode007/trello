import { Client } from "pg";
import { beforeAll } from "bun:test";

const TEST_DB_NAME = "trello_test", PG_BASE_URL = "postgresql://deep@localhost:5432";
const TEST_DB_URL = `${PG_BASE_URL}/${TEST_DB_NAME}`;
const TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

declare global
{
    var TEST_BASE_URL: string;
}

beforeAll(async () =>
{
    console.log(`\n🧹 Clearing test database: ${TEST_DB_NAME}...`);

    process.env.DATABASE_URL = TEST_DB_URL;
    globalThis.TEST_BASE_URL = TEST_BASE_URL;

    const pgClient = new Client({ connectionString: TEST_DB_URL });
    await pgClient.connect();

    const { rows } = await pgClient.query<{ tableName: string }>(`
        SELECT format('%I.%I', schemaname, tablename) AS "tableName"
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations';
    `);

    if (rows.length > 0)
        await pgClient.query(`TRUNCATE TABLE ${rows.map(({ tableName }) => tableName).join(", ")} RESTART IDENTITY CASCADE;`);

    await pgClient.end();
    console.log(`🚀 Starting integration tests against ${TEST_BASE_URL}...`);
});
