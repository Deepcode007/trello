-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "accepted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "visible" BOOLEAN NOT NULL DEFAULT true;
