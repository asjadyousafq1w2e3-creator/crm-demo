-- AlterTable
ALTER TABLE "email_verification_batch" ADD COLUMN     "checked_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "last_polled_at" TIMESTAMP(3),
ADD COLUMN     "provider_meta" JSONB,
ADD COLUMN     "provider_status" TEXT,
ADD COLUMN     "provider_task_id" TEXT;

-- AlterTable
ALTER TABLE "email_verification_item" ADD COLUMN     "raw" JSONB;

-- AlterTable
ALTER TABLE "pharmacy_master" ADD COLUMN     "email_check_detail" TEXT,
ADD COLUMN     "email_checked_at" TIMESTAMP(3);

