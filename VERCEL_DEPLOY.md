# expressdiabetics — display-only Vercel demo

**Ready to deploy without a database, backend service, account setup, or secrets.**
This copy shows the original Pharmacy Outreach CRM screens with a static snapshot of 974 original pharmacy records, plus sample activity.
It does not replace the CRM interface with another application.

## Deploy

1. Import this repository into Vercel.
2. Set **Root Directory** to `.` (the repository root) and **Framework Preset** to `Next.js`.
3. Keep the default install command and build command (`npm run build`).
4. Click **Deploy**. **No environment variables are required.**

`vercel.json` explicitly enables `CRM_SHOWCASE_MODE=true`. This copy also defaults
into display mode locally. No PostgreSQL database, migrations, Gmail, verification API,
campaign worker, or storage service is used.

| URL | Opens |
| --- | --- |
| `/` | Medicine wholesale landing page with a sample catalog and stock previews |
| `/crm` | Original CRM dashboard, directly accessible |
| `/login?next=/crm` | Original sign-in screen, prefilled with public demo details |
| `/pharmacies`, `/campaigns`, `/inbox`, etc. | Original CRM screens, using the original pharmacy records and sample activity |

Search, filters, navigation, profile/campaign previews, theme switching, and sample CSV
exports work. Forms and live operations show a display-only notice. Nothing is saved,
sent, imported, or connected. Original CRM components and layouts are retained.

The landing page includes medicine category filters, product search, detail previews, and
B2B demo login. All product packaging and stock quantities are illustrative; ordering and
payments are unavailable in this display demo.

## Public demo credentials

```text
Email: demo@expressdiabetics.example
Password: ExpressDiabetics2026!
```

These are just public display-demo details; they are not credentials for any real system.
The Open CRM button bypasses sign-in so visitors can immediately explore the UI.

## Optional domain and CRM subdomain

The Vercel URL works immediately; a custom domain is optional. If wanted, add
`yourdomain.com` and `crm.yourdomain.com` to the same Vercel project, follow Vercel's
DNS instructions, then set and redeploy:

```text
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
NEXT_PUBLIC_CRM_URL=https://crm.yourdomain.com
```

The main domain shows the landing page, and the `crm.` subdomain shows the original CRM.
For a different CRM hostname, optionally set `CRM_HOST=workspace.yourdomain.com`.

## Local preview

```bash
npm ci
npm run dev
```

Open `http://localhost:3000/` or `http://localhost:3000/crm`.
The original working CRM code is retained behind the explicit `CRM_SHOWCASE_MODE=false`
opt-out. Leave showcase mode enabled for this public demo.

Light mode is the default and supplementary CRM guides are hidden. The registry snapshot
contains the 974 original pharmacy records and their available business contacts, addresses,
identifiers, notes and recorded statuses, approved for publication by the owner. Sample
campaigns and conversations remain illustrative. Original user accounts, passwords, mailbox
credentials and private application settings are excluded.
