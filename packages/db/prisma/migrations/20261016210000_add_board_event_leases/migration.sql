ALTER TABLE "board_events"
    ADD COLUMN IF NOT EXISTS "claimedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "claimExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "board_events_boardId_published_claimExpiresAt_idx"
    ON "board_events"("boardId", "published", "claimExpiresAt");
