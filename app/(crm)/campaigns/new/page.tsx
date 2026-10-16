import { createCampaign } from "@/lib/campaign/actions";
import { requirePagePermission } from "@/lib/auth";
import { Card, Note, PageHeader } from "@/components/ui";
import { config } from "@/lib/config";
import { SUPPORTED_VARIABLES } from "@/lib/campaign/personalize";
import { TemplatePicker } from "@/components/template-picker";
import { templateLibrary } from "@/lib/campaign/templates";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "New campaign" };

const TZ = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "UTC"];

export default async function NewCampaign({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("campaign.edit");
  const { error } = await searchParams;
  const templates = await templateLibrary();

  return (
    <div className="space-y-4 max-w-6xl">
      <Link href="/campaigns" className="text-[12px] link">← Campaigns</Link>
      <PageHeader title="New campaign"
        subtitle="Creating a campaign never sends anything. The recipient list, the eligibility review and the schedule are all confirmed on the next screen, and sending still needs an explicit start." />

      {error && <Note tone="bad">{error}</Note>}

      {/* One form spanning both columns: the picker writes into the fields on the left and
          carries the template id, which is what brings its follow-up steps across on submit. */}
      <form action={createCampaign}
        className="grid lg:grid-cols-[1fr_20rem] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        <Card title="Message" subtitle="Personalisation is rendered against the real record at send time">
          <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted block mb-1">Campaign name</label>
            <input name="name" required className="input" placeholder="Florida independent outreach" />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-1">Subject</label>
            <input name="subject" required className="input"
                   placeholder="Wholesale pricing for {{pharmacy_name}}" />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-1">Body</label>
            {/* Starts empty on purpose. A pre-filled draft that reads like real writing is the
                thing people forget to replace, and it also makes the first template click look
                like it is about to destroy something. */}
            <textarea name="bodyText" required rows={11} className="input font-mono text-[12px]"
              placeholder={"Write the message, or pick a template on the right.\n\nHello {{contact_name}},\n\n..."} />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-1">Signature</label>
            <input name="signature" className="input" placeholder="Jane Doe · Wholesale Team" />
          </div>
          <div className="text-[11px] text-muted">
            Variables: {SUPPORTED_VARIABLES.map((v) => (
              <code key={v} className="mr-2 text-ink/70">{`{{${v}}}`}</code>
            ))}
            <div className="mt-1">A variable with no value renders as empty — never as
              &quot;undefined&quot; or a leftover placeholder.</div>
          </div>
          </div>
        </Card>

        <Card title="Schedule"
          subtitle="Evaluated in the campaign's own timezone, never the server's">
          <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-[11px] text-muted block mb-1">Timezone</label>
              <select name="timezone" defaultValue={config.schedule.timezone} className="input">
                {TZ.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">Start time</label>
              <input name="sendingStartTime" type="time" defaultValue={config.schedule.start} className="input" />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">End time</label>
              <input name="sendingEndTime" type="time" defaultValue={config.schedule.end} className="input" />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">Daily limit</label>
              <input name="dailyLimit" type="number" min={1} defaultValue={100} className="input" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-1">Sending days</label>
            <select name="sendingDays" defaultValue="1,2,3,4,5" className="input">
              <option value="1,2,3,4,5">Monday–Friday</option>
              <option value="1,2,3,4,5,6">Monday–Saturday</option>
              <option value="1,2,3,4,5,6,7">Every day</option>
            </select>
          </div>
          </div>
        </Card>

        <Note tone="neutral">
          Nothing is sent by creating this. The next screen builds the recipient list, shows exactly
          how many pass eligibility and why the rest do not, and keeps the send behind an explicit
          button.
        </Note>

        <button type="submit" className="btn btn-primary">Create campaign</button>
      </div>

      <aside className="lg:sticky lg:top-[4.5rem]">
        <TemplatePicker templates={templates} />
      </aside>
      </form>
    </div>
  );
}
