-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "apexbookAgentTokenEnc" TEXT,
ADD COLUMN     "apexbookApiUrl" TEXT,
ADD COLUMN     "apexbookHeartbeatMinutes" INTEGER,
ADD COLUMN     "bookingRefPrefix" TEXT,
ADD COLUMN     "emailFromAddress" TEXT,
ADD COLUMN     "emailFromName" TEXT,
ADD COLUMN     "emailReplyTo" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPasswordEnc" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecurity" TEXT,
ADD COLUMN     "smtpUser" TEXT,
ADD COLUMN     "stripeSecretKeyEnc" TEXT,
ADD COLUMN     "stripeWebhookSecretEnc" TEXT;

