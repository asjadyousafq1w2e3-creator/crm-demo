import { requireSession } from "@/lib/auth";
import { permissionsFor, ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/rbac";
import { changeOwnPassword } from "@/lib/user-actions";
import { Card, Note, PageHeader, Row } from "@/components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

export default async function Account({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string; first?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const user = await prisma.appUser.findUnique({ where: { id: session.userId } });
  const permissions = permissionsFor(session.role);

  return (
    <>
      <PageHeader title="Your account"
        subtitle="Your sign-in details and exactly what your role permits." />

      {sp.first && (
        <Note tone="warn">
          This account is using a password an administrator generated. Choose your own below —
          until you do, whoever issued it can still read it from their screen.
        </Note>
      )}
      {sp.ok && <Note tone="ok">{sp.ok}</Note>}
      {sp.error && <Note tone="bad">{sp.error}</Note>}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Details">
          <div className="space-y-0.5">
            <Row label="Name" value={session.name ?? "—"} />
            <Row label="Email" value={session.email} />
            <Row label="Role" value={ROLE_LABEL[session.role]} />
            <Row label="Last signed in"
              value={user?.lastLoginAt
                ? user.lastLoginAt.toISOString().slice(0, 16).replace("T", " ")
                : "first session"} />
            <Row label="Account created"
              value={user?.createdAt.toISOString().slice(0, 10) ?? "—"} />
          </div>
          <p data-ui="description" className="text-[11px] text-muted mt-3 pt-3 hairline leading-relaxed">
            {ROLE_DESCRIPTION[session.role]}
          </p>
        </Card>

        <Card title="Change password"
          subtitle="Your current password is required even though you are signed in">
          <form action={changeOwnPassword} className="space-y-3">
            <label className="block">
              <span className="block text-[12px] text-muted mb-1">Current password</span>
              <input name="current" type="password" required autoComplete="current-password"
                className="input" />
            </label>
            <label className="block">
              <span className="block text-[12px] text-muted mb-1">
                New password <span className="text-muted">· at least 10 characters</span>
              </span>
              <input name="next" type="password" required minLength={10}
                autoComplete="new-password" className="input" />
            </label>
            <button className="btn btn-primary">Change password</button>
          </form>
        </Card>
      </div>

      <Card title="What your role permits"
        subtitle="Checked on the server for every action — hiding a button is only a courtesy">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
          {permissions.map((p) => (
            <div key={p} className="flex items-center gap-2 text-[12px]">
              <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
              <code className="text-muted">{p}</code>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
