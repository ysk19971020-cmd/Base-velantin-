-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "lastDailyClaimAt" TIMESTAMP(3);
ALTER TABLE "Wallet" ADD COLUMN "lastAdRewardAt" TIMESTAMP(3);
