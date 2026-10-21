import { Client } from "pg";
import { env } from "../env";

const TEST_DB_NAME = "trello_test";
const TEST_DB_URL = (env.RUN_DB_TESTS === "1" ? env.DATABASE_TEST_URL : env.DATABASE_URL);

async function clearTestDatabase()
{
    console.log(`\n🧹 Globally clearing test database: ${TEST_DB_NAME}...`);

    const pgClient = new Client({ connectionString: TEST_DB_URL });
    await pgClient.connect();

    const { rows } = await pgClient.query<{ tableName: string }>(`
    SELECT format('%I.%I', schemaname, tablename) AS "tableName"
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations';
  `);

    if (rows.length > 0)
    {
        const tables = rows.map(({ tableName }) => tableName).join(", ");
        await pgClient.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
    }

    await pgClient.end();
    console.log(`✅ Test database cleared! Starting integration tests...`);
}

clearTestDatabase().catch((err) =>
{
    console.error("Failed to clear database:", err);
    process.exit(1);
});
