-- AlterTable
ALTER TABLE "pharmacy_master" ADD COLUMN     "email_kind" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "import_job" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "dataset_date" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DECLARED',
    "declared_columns" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "file_name" TEXT,
    "file_format" TEXT,
    "file_bytes" INTEGER,
    "content_hash" TEXT,
    "stored_path" TEXT,
    "total_rows" INTEGER,
    "analysis" JSONB,
    "batch_id" INTEGER,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "cleaned" JSONB,
    "decision" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "reason" TEXT,
    "notes" JSONB,
    "pharmacy_id" INTEGER,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_job_status_idx" ON "import_job"("status");

-- CreateIndex
CREATE INDEX "import_row_job_id_decision_idx" ON "import_row"("job_id", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_job_id_row_number_key" ON "import_row"("job_id", "row_number");

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "pharmacy_import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

