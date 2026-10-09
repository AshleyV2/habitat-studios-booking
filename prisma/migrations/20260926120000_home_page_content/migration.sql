-- Additive: optional public home page text. Existing data is untouched.
-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "announcement" TEXT,
ADD COLUMN     "homeHeadline" TEXT,
ADD COLUMN     "homeIntro" TEXT;

