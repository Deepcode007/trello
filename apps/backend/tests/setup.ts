const TEST_DB_NAME = "trello_test", PG_BASE_URL = "postgresql://deep@localhost:5432";

declare global
{
    var TEST_BASE_URL: string;
}

process.env.DATABASE_URL = `${PG_BASE_URL}/${TEST_DB_NAME}`;
globalThis.TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";