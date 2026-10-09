-- Additive: optional public website page content. Existing data is untouched.
-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "aboutText" TEXT,
ADD COLUMN     "communalText" TEXT,
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "featuredQuote" TEXT,
ADD COLUMN     "featuredQuoteAuthor" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "privacyPolicy" TEXT,
ADD COLUMN     "roomsIntro" TEXT,
ADD COLUMN     "tagline" TEXT;

