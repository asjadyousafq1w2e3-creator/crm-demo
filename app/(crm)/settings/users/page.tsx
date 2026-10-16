import { requirePagePermission } from "@/lib/auth";
import { listUsers } from "@/lib/users";
import { assignableRoles, ROLE_DESCRIPTION, ROLE_LABEL, ROLE_PERMISSIONS, ROLES, PERMISSIONS }
  from "@/lib/rbac";
import { changeRole, createUser, deleteUser, resetPassword, setStatus } from "@/lib/user-actions";
import { Badge, Card, Note, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operators" };

export default async function Users({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string; pw?: string }>;
}) {
  const session = await requirePagePermission("users.manage");
  const sp = await searchParams;
  const users = await listUsers();
  const assignable = assignableRoles(session.role);

  return (
    <>
      <PageHeader title="Operators"
        subtitle="Who can sign in, and what each of them may do. Permissions are enforced on the server for every action, so removing someone's button and removing their access are the same thing." />

      {sp.pw && (
        <Note tone="warn">
          <strong>One-time password:</strong>{" "}
          <code className="px-1.5 py-0.5 rounded bg-raised text-ink select-all">{sp.pw}</code>
          {" "}— hand this over in person or through a channel you trust. It is not stored in
          readable form and cannot be shown again, and the account must change it at first sign-in.
        </Note>
      )}
      {sp.ok && !sp.pw && <Note tone="ok">{sp.ok}</Note>}
      {sp.error && <Note tone="bad">{sp.error}</Note>}

      <Card title="Accounts" subtitle={`${users.length} operator${users.length === 1 ? "" : "s"}`}
        pad={false}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th>Operator</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Added</th>
              <th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === session.userId;
                const locked = u.role === "OWNER" && session.role !== "OWNER";
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium">
                        {u.name || u.email.split("@")[0]}
                        {self && <span className="text-muted font-normal"> · you</span>}
                      </div>
                      <div className="text-[11px] text-muted">{u.email}</div>
                    </td>
                    <td>
                      {locked ? <Badge value={u.role} /> : (
                        <form action={changeRole.bind(null, u.id)} className="flex items-center gap-1.5">
                          <select name="role" defaultValue={u.role} className="inp text-[12px] py-1">
                            {assignable.map((r) => (
                              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                            ))}
                          </select>
                          <button className="btn btn-sm">Set</button>
                        </form>
                      )}
                    </td>
                    <td>
                      <Badge value={u.status} />
                      {u.mustChangePassword && (
                        <div className="text-[10px] text-warn mt-0.5">must change password</div>
                      )}
                    </td>
                    <td className="text-[12px] text-muted tabular-nums">
                      {u.lastLoginAt
                        ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ")
                        : "never"}
                    </td>
                    <td className="text-[12px] text-muted tabular-nums">
                      {u.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <form action={resetPassword.bind(null, u.id)}>
                          <button className="btn btn-sm" disabled={locked}>Reset password</button>
                        </form>
                        {u.status === "ACTIVE" ? (
                          <form action={setStatus.bind(null, u.id, "SUSPENDED")}>
                            <button className="btn btn-sm" disabled={self || locked}>Suspend</button>
                          </form>
                        ) : (
                          <form action={setStatus.bind(null, u.id, "ACTIVE")}>
                            <button className="btn btn-sm" disabled={locked}>Reactivate</button>
                          </form>
                        )}
                        <form action={deleteUser.bind(null, u.id)}>
                          <button className="btn btn-sm btn-danger" disabled={self || locked}>
                            Remove
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Add an operator"
          subtitle="A one-time password is generated for you to hand over">
          <form action={createUser} className="space-y-3">
            <label className="block">
              <span className="block text-[12px] text-muted mb-1">Email</span>
              <input name="email" type="email" required className="input"
                placeholder="colleague@example.com" />
            </label>
            <label className="block">
              <span className="block text-[12px] text-muted mb-1">Name (optional)</span>
              <input name="name" className="input" placeholder="Jordan Ellis" />
            </label>
            <label className="block">
              <span className="block text-[12px] text-muted mb-1">Role</span>
              <select name="role" className="input" defaultValue="VIEWER">
                {assignable.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_DESCRIPTION[r]}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary">Create account</button>
            {session.role !== "OWNER" && (
              <p className="text-[11px] text-muted">
                Only an owner can create or modify another owner.
              </p>
            )}
          </form>
        </Card>

        <Card title="Roles" subtitle="What each role can reach">
          <div className="space-y-3">
            {ROLES.map((r) => (
              <div key={r} className="pb-3 border-b border-line/60 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <Badge value={r} />
                  <span className="text-[12px] text-muted">
                    {ROLE_PERMISSIONS[r].length} of {PERMISSIONS.length} permissions
                  </span>
                </div>
                <p className="text-[11px] text-muted mt-1 leading-relaxed">{ROLE_DESCRIPTION[r]}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Permission matrix"
        subtitle="The authoritative table — code asks for a permission, never for a role" pad={false}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th>Permission</th>
              {ROLES.map((r) => <th key={r} className="text-center">{ROLE_LABEL[r]}</th>)}
            </tr></thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td><code className="text-[12px]">{p}</code></td>
                  {ROLES.map((r) => (
                    <td key={r} className="text-center">
                      {ROLE_PERMISSIONS[r].includes(p)
                        ? <span className="text-ok" title="allowed">●</span>
                        : <span className="text-muted/40" title="denied">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
