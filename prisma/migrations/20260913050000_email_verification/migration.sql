-- CreateTable
CREATE TABLE "email_verification_batch" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scope" JSONB NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "total" INTEGER NOT NULL DEFAULT 0,
    "valid" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "risky" INTEGER NOT NULL DEFAULT 0,
    "catch_all" INTEGER NOT NULL DEFAULT 0,
    "unknown" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exported_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "email_verification_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_item" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
    "detail" TEXT,

    CONSTRAINT "email_verification_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_verification_batch_status_idx" ON "email_verification_batch"("status");

-- CreateIndex
CREATE INDEX "email_verification_item_batch_id_result_idx" ON "email_verification_item"("batch_id", "result");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_item_batch_id_pharmacy_id_key" ON "email_verification_item"("batch_id", "pharmacy_id");

-- AddForeignKey
ALTER TABLE "email_verification_item" ADD CONSTRAINT "email_verification_item_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "email_verification_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_item" ADD CONSTRAINT "email_verification_item_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacy_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

