-- AlterTable
ALTER TABLE "campaign" ADD COLUMN     "use_assigned_mailbox" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "pharmacy_master" ADD COLUMN     "assigned_mailbox_id" INTEGER;

-- CreateTable
CREATE TABLE "campaign_mailbox" (
    "campaign_id" INTEGER NOT NULL,
    "mailbox_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_mailbox_pkey" PRIMARY KEY ("campaign_id","mailbox_id")
);

-- CreateIndex
CREATE INDEX "campaign_mailbox_mailbox_id_idx" ON "campaign_mailbox"("mailbox_id");

-- CreateIndex
CREATE INDEX "pharmacy_master_assigned_mailbox_id_idx" ON "pharmacy_master"("assigned_mailbox_id");

-- AddForeignKey
ALTER TABLE "pharmacy_master" ADD CONSTRAINT "pharmacy_master_assigned_mailbox_id_fkey" FOREIGN KEY ("assigned_mailbox_id") REFERENCES "mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_mailbox" ADD CONSTRAINT "campaign_mailbox_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_mailbox" ADD CONSTRAINT "campaign_mailbox_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

