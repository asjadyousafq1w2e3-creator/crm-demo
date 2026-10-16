import { requirePagePermission } from "@/lib/auth";
import { declareJob } from "@/lib/import/actions";
import { FIELDS } from "@/lib/import/fields";
import { Card, Note, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icon";
import { DeclareForm } from "./declare-form";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Declare a dataset" };

/**
 * Step one: describe the file before uploading it.
 *
 * Declaring the shape first is the point of the whole flow. A file whose columns silently differ
 * from what was expected is the commonest way a bad import happens, and it is only catchable if
 * somebody said beforehand what the columns were meant to be.
 */
export default async function NewImport({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePagePermission("verification.manage");
  const { error } = await searchParams;

  return (
    <>
      <Link href="/data/import" className="text-[12px] link">← Imports</Link>
      <PageHeader title="Declare the dataset"
        subtitle="Describe the file before you upload it. The upload is then checked against what you declared, so a file that is not the one you expected is caught before any of it reaches the registry." />

      {error && <Note tone="bad">{error}</Note>}

      <Note tone="neutral">
        <strong>An email column is required.</strong> This registry exists to reach pharmacies by
        email; a file without one cannot be imported. Rows whose address is missing or malformed
        are still kept — they simply never become outreach-eligible.
      </Note>

      <form action={declareJob} className="space-y-4">
        <Card title="The dataset" subtitle="What this file is and where it came from">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="block t-small text-muted mb-1">Name</span>
              <input name="name" required className="input"
                placeholder="e.g. Ohio TDDD roster, September 2026" />
            </label>
            <label className="block">
              <span className="block t-small text-muted mb-1">Source type</span>
              <select name="sourceType" className="input" defaultValue="STATE_BOARD">
                <option value="STATE_BOARD">State board — highest authority</option>
                <option value="COMMERCIAL">Commercial file — may only fill blanks</option>
                <option value="MANUAL">Manual list — may only fill blanks</option>
              </select>
            </label>
            <label className="block">
              <span className="block t-small text-muted mb-1">State (optional)</span>
              <input name="jurisdiction" maxLength={2} className="input uppercase"
                placeholder="OH" />
            </label>
            <label className="block">
              <span className="block t-small text-muted mb-1">
                Dataset date <span className="text-muted">· as published by the source</span>
              </span>
              <input name="datasetDate" type="date" className="input" />
            </label>
          </div>
          <p data-ui="description" className="t-small text-muted mt-3 pt-3 hairline leading-relaxed">
            Source type decides what happens on a match. A state board may correct a value the
            registry already holds; a commercial or manual file may only fill a gap, never
            overwrite what a board supplied.
          </p>
        </Card>

        <DeclareForm fields={FIELDS} />

        <div className="flex items-center gap-2">
          <button className="btn btn-primary">
            <Icon name="check_circle" size={16} /> Save and continue to upload
          </button>
          <Link href="/data/import" className="btn">Cancel</Link>
        </div>
      </form>
    </>
  );
}
