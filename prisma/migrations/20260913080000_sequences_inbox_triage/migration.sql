-- AlterTable
ALTER TABLE "campaign_recipient" ADD COLUMN     "next_step_at" TIMESTAMP(3),
ADD COLUMN     "step_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stopped_reason" TEXT;

-- AlterTable
ALTER TABLE "conversation" ADD COLUMN     "assigned_to_id" INTEGER,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'UNCATEGORISED',
ADD COLUMN     "category_reason" TEXT,
ADD COLUMN     "category_source" TEXT NOT NULL DEFAULT 'AUTOMATIC',
ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "snoozed_until" TIMESTAMP(3),
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "follow_up" ADD COLUMN     "assigned_to_id" INTEGER,
ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "snooze_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "campaign_step" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "step_number" INTEGER NOT NULL,
    "wait_days" INTEGER NOT NULL DEFAULT 3,
    "subject" TEXT,
    "body_html" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipient_step" (
    "id" SERIAL NOT NULL,
    "recipient_id" INTEGER NOT NULL,
    "step_number" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipient_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_template" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REPLY',
    "subject" TEXT,
    "body_html" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "purpose" TEXT,
    "times_used" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_step_campaign_id_idx" ON "campaign_step"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_step_campaign_id_step_number_key" ON "campaign_step"("campaign_id", "step_number");

-- CreateIndex
CREATE INDEX "campaign_recipient_step_recipient_id_idx" ON "campaign_recipient_step"("recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipient_step_recipient_id_step_number_key" ON "campaign_recipient_step"("recipient_id", "step_number");

-- CreateIndex
CREATE UNIQUE INDEX "email_template_name_key" ON "email_template"("name");

-- CreateIndex
CREATE INDEX "email_template_kind_idx" ON "email_template"("kind");

-- CreateIndex
CREATE INDEX "campaign_recipient_next_step_at_idx" ON "campaign_recipient"("next_step_at");

-- CreateIndex
CREATE INDEX "conversation_state_last_message_at_idx" ON "conversation"("state", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_category_idx" ON "conversation"("category");

-- CreateIndex
CREATE INDEX "conversation_assigned_to_id_idx" ON "conversation"("assigned_to_id");

-- CreateIndex
CREATE INDEX "follow_up_assigned_to_id_status_idx" ON "follow_up"("assigned_to_id", "status");

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_step" ADD CONSTRAINT "campaign_step_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient_step" ADD CONSTRAINT "campaign_recipient_step_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

