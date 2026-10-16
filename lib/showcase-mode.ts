/** This copy is a display-only demo of the ORIGINAL CRM, with no external services. */
export const isCrmShowcase = () => process.env.CRM_SHOWCASE_MODE !== "false";
export const SHOWCASE_EMAIL = "demo@expressdiabetics.example";
export const SHOWCASE_PASSWORD = "ExpressDiabetics2026!";
export const SHOWCASE_SESSION = {
  userId: 1, email: SHOWCASE_EMAIL, name: "Jamie Demo", role: "OWNER" as const,
  mustChangePassword: false,
};
