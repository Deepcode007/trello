-- 1. Create Transactional Outbox Table for Monotonic Board Event Streams
CREATE TABLE IF NOT EXISTS "board_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "board_events_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "board_events_boardId_sequence_key" ON "board_events"("boardId", "sequence");
CREATE INDEX IF NOT EXISTS "board_events_boardId_published_idx" ON "board_events"("boardId", "published");
CREATE INDEX IF NOT EXISTS "board_events_createdAt_idx" ON "board_events"("createdAt");
