-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "pharmacy_master" (
    "id" SERIAL NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "normalized_name" TEXT,
    "doing_business_as" TEXT,
    "pharmacy_type" TEXT,
    "street_address" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "owner_name" TEXT,
    "pic_name" TEXT,
    "buyer_name" TEXT,
    "primary_license_number" TEXT,
    "license_status" TEXT,
    "license_type" TEXT,
    "npi" TEXT,
    "ncpdp_id" TEXT,
    "number_of_locations" INTEGER,
    "data_status" TEXT NOT NULL DEFAULT 'DATA_READY',
    "verification_status" TEXT NOT NULL DEFAULT 'READY_FOR_VERIFICATION',
    "campaign_eligible" BOOLEAN NOT NULL DEFAULT false,
    "ownership_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "operational_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "email_verification_status" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
    "crm_status" TEXT NOT NULL DEFAULT 'NEW',
    "exclusion_reason" TEXT,
    "license_verification_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ownership_verification_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "operational_verification_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "pharmacy_type_verification_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "contact_verification_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source_missing" BOOLEAN NOT NULL DEFAULT false,
    "missing_since" TIMESTAMP(3),
    "import_batch_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "lead_status" TEXT NOT NULL DEFAULT 'NOT_CONTACTED',

    CONSTRAINT "pharmacy_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_contact" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "email" TEXT,
    "phone" TEXT,
    "source_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "email_status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pharmacy_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_identifier" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "source_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_identifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_provenance" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "source_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "authority_rank" INTEGER NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "dataset_date" TEXT,
    "retrieved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_change" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER,
    "source_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "change_type" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_task" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "verification_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "trigger" TEXT NOT NULL,
    "batch_id" INTEGER,
    "assigned_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_result" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "verification_type" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "verified_by" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "evidence_source" TEXT,
    "evidence_url" TEXT,
    "notes" TEXT,

    CONSTRAINT "verification_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_import_batch" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "dataset_date" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "records_received" INTEGER NOT NULL DEFAULT 0,
    "records_accepted" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_unchanged" INTEGER NOT NULL DEFAULT 0,
    "records_rejected" INTEGER NOT NULL DEFAULT 0,
    "records_review_required" INTEGER NOT NULL DEFAULT 0,
    "duplicates_prevented" INTEGER NOT NULL DEFAULT 0,
    "content_sha256" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "email_address" TEXT NOT NULL,
    "display_name" TEXT,
    "domain" TEXT,
    "encrypted_refresh_token" TEXT,
    "provider_account_id" TEXT,
    "gmail_history_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "health_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "ramp_stage" TEXT NOT NULL DEFAULT 'NEW',
    "daily_limit" INTEGER NOT NULL DEFAULT 20,
    "sent_today" INTEGER NOT NULL DEFAULT 0,
    "sent_date" TEXT,
    "sending_start_time" TEXT NOT NULL DEFAULT '09:00',
    "sending_end_time" TEXT NOT NULL DEFAULT '16:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "last_error" TEXT,
    "connected_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduled_start_at" TIMESTAMP(3),
    "scheduled_end_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "sending_days" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "sending_start_time" TEXT NOT NULL DEFAULT '09:00',
    "sending_end_time" TEXT NOT NULL DEFAULT '16:00',
    "daily_limit" INTEGER NOT NULL DEFAULT 100,
    "sent_date" TEXT,
    "sent_today" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipient" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "mailbox_id" INTEGER,
    "recipient_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "block_reason" TEXT,
    "queued_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "provider_thread_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_entry" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "campaign_id" INTEGER,
    "recipient_id" INTEGER,
    "mailbox_id" INTEGER NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "subject" TEXT,
    "contact_email" TEXT NOT NULL,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_message" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "mailbox_id" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "rfc_message_id" TEXT,
    "in_reply_to" TEXT,
    "references" TEXT,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "cc_address" TEXT,
    "subject" TEXT,
    "body_text" TEXT,
    "body_html" TEXT,
    "is_bounce" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "conversation_id" INTEGER,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "follow_up_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" SERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "pharmacy_id" INTEGER,
    "batch_id" INTEGER,
    "task_id" INTEGER,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pharmacy_master_state_idx" ON "pharmacy_master"("state");

-- CreateIndex
CREATE INDEX "pharmacy_master_city_idx" ON "pharmacy_master"("city");

-- CreateIndex
CREATE INDEX "pharmacy_master_verification_status_idx" ON "pharmacy_master"("verification_status");

-- CreateIndex
CREATE INDEX "pharmacy_master_import_batch_id_idx" ON "pharmacy_master"("import_batch_id");

-- CreateIndex
CREATE INDEX "pharmacy_master_email_idx" ON "pharmacy_master"("email");

-- CreateIndex
CREATE INDEX "pharmacy_master_phone_idx" ON "pharmacy_master"("phone");

-- CreateIndex
CREATE INDEX "pharmacy_master_normalized_name_idx" ON "pharmacy_master"("normalized_name");

-- CreateIndex
CREATE INDEX "pharmacy_master_state_primary_license_number_idx" ON "pharmacy_master"("state", "primary_license_number");

-- CreateIndex
CREATE INDEX "pharmacy_contact_pharmacy_id_idx" ON "pharmacy_contact"("pharmacy_id");

-- CreateIndex
CREATE INDEX "pharmacy_identifier_pharmacy_id_idx" ON "pharmacy_identifier"("pharmacy_id");

-- CreateIndex
CREATE INDEX "pharmacy_identifier_kind_value_idx" ON "pharmacy_identifier"("kind", "value");

-- CreateIndex
CREATE INDEX "field_provenance_pharmacy_id_field_idx" ON "field_provenance"("pharmacy_id", "field");

-- CreateIndex
CREATE INDEX "field_change_pharmacy_id_detected_at_idx" ON "field_change"("pharmacy_id", "detected_at");

-- CreateIndex
CREATE INDEX "verification_task_pharmacy_id_idx" ON "verification_task"("pharmacy_id");

-- CreateIndex
CREATE INDEX "verification_task_status_verification_type_idx" ON "verification_task"("status", "verification_type");

-- CreateIndex
CREATE INDEX "verification_result_pharmacy_id_verification_type_idx" ON "verification_result"("pharmacy_id", "verification_type");

-- CreateIndex
CREATE INDEX "pharmacy_import_batch_source_dataset_date_idx" ON "pharmacy_import_batch"("source", "dataset_date");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_email_address_key" ON "mailbox"("email_address");

-- CreateIndex
CREATE INDEX "mailbox_status_idx" ON "mailbox"("status");

-- CreateIndex
CREATE INDEX "campaign_status_idx" ON "campaign"("status");

-- CreateIndex
CREATE INDEX "campaign_scheduled_start_at_idx" ON "campaign"("scheduled_start_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipient_idempotency_key_key" ON "campaign_recipient"("idempotency_key");

-- CreateIndex
CREATE INDEX "campaign_recipient_status_idx" ON "campaign_recipient"("status");

-- CreateIndex
CREATE INDEX "campaign_recipient_scheduled_at_idx" ON "campaign_recipient"("scheduled_at");

-- CreateIndex
CREATE INDEX "campaign_recipient_mailbox_id_idx" ON "campaign_recipient"("mailbox_id");

-- CreateIndex
CREATE INDEX "campaign_recipient_campaign_id_status_idx" ON "campaign_recipient"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipient_campaign_id_pharmacy_id_key" ON "campaign_recipient"("campaign_id", "pharmacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entry_email_key" ON "suppression_entry"("email");

-- CreateIndex
CREATE INDEX "suppression_entry_email_idx" ON "suppression_entry"("email");

-- CreateIndex
CREATE INDEX "conversation_pharmacy_id_idx" ON "conversation"("pharmacy_id");

-- CreateIndex
CREATE INDEX "conversation_last_message_at_idx" ON "conversation"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_mailbox_id_provider_thread_id_key" ON "conversation"("mailbox_id", "provider_thread_id");

-- CreateIndex
CREATE INDEX "email_message_provider_thread_id_idx" ON "email_message"("provider_thread_id");

-- CreateIndex
CREATE INDEX "email_message_conversation_id_idx" ON "email_message"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_message_mailbox_id_provider_message_id_key" ON "email_message"("mailbox_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "follow_up_due_at_idx" ON "follow_up"("due_at");

-- CreateIndex
CREATE INDEX "follow_up_status_idx" ON "follow_up"("status");

-- CreateIndex
CREATE INDEX "audit_event_pharmacy_id_created_at_idx" ON "audit_event"("pharmacy_id", "created_at");

-- AddForeignKey
ALTER TABLE "pharmacy_master" ADD CONSTRAINT "pharmacy_master_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "pharmacy_import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_contact" ADD CONSTRAINT "pharmacy_contact_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_identifier" ADD CONSTRAINT "pharmacy_identifier_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_change" ADD CONSTRAINT "field_change_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_task" ADD CONSTRAINT "verification_task_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_result" ADD CONSTRAINT "verification_result_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "verification_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

