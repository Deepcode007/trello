/*
  Warnings:

  - A unique constraint covering the columns `[userId,orgId]` on the table `membership` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "membership_userId_orgId_key" ON "membership"("userId", "orgId");
