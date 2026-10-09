-- Session-length pricing (rate plans) and room photos. Additive only.
ALTER TABLE "Room" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Room" ADD COLUMN "ratePlans" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Booking" ADD COLUMN "ratePlanId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "ratePlanName" TEXT;
