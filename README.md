# Pharmacy First — CRM display demo

Premium medicine wholesale landing page for pharmacies, plus the **original Pharmacy Outreach CRM interface**.
The CRM is a display-only showcase with fictional records. No database, secrets, account
setup, paid service, or email connection is required.

## Deploy to Vercel

Import this repository into Vercel and click **Deploy**.

- Framework: **Next.js** (automatically detected)
- Root Directory: **`.`** — leave it at the repository root
- Node.js: **22.x**, pinned in `package.json`
- Install: `npm ci`
- Build: `npm run build`
- Environment variables: **none required**

The checked-in configuration explicitly enables display mode and disables live sending.
The GitHub build check tests a clean Linux install and production build on Node.js 22.

## Run locally

Use Node.js 22 (`nvm use` if you have nvm), then:

```bash
npm ci
npm run dev
```

Open http://localhost:3000 for the landing page or http://localhost:3000/crm for the original CRM.

## What works in this demo

The landing page includes six featured medicines, category filters, product search, medicine
detail previews, and a stock overview. Packaging and stock quantities are illustrative.

Browse the original dashboard, search/filter sample records, open profiles and campaigns,
read example conversations, explore verification/follow-up/settings screens, change themes,
and export fictional sample records. Changes, real sending, uploads, and external account
connections are disabled.

The **Open CRM** button enters directly. **B2B demo login** shows the original sign-in form:

```text
Email: demo@pharmacyfirst.example
Password: PharmacyFirst2026!
```

See [VERCEL_DEPLOY.md](VERCEL_DEPLOY.md) for optional main-domain and CRM-subdomain setup.
