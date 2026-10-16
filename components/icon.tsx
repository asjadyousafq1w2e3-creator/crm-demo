/**
 * Material Symbols, as used in the design reference.
 *
 * The font is subset to exactly these glyphs (5 KB rather than 3.8 MB) and self-hosted, so no
 * request leaves the deployment at runtime and the icons work offline. Glyphs are addressed by
 * codepoint rather than by ligature name: ligature lookups would have forced every icon in the
 * family to be kept in the subset.
 *
 * Icons here are decorative - each sits beside a text label - so they are hidden from assistive
 * technology rather than given a redundant name.
 */
export const ICONS = {
  add: "\ue145",
  alternate_email: "\ue0e6",
  analytics: "\uef3e",
  block: "\uf08c",
  bolt: "\uea0b",
  campaign: "\uef49",
  check_circle: "\uf0be",
  chevron_right: "\ue5cc",
  close: "\ue5cd",
  dashboard: "\ue871",
  delete: "\ue92e",
  dns: "\ue875",
  domain_verification: "\uef4c",
  done_all: "\ue877",
  edit: "\uf097",
  error: "\uf8b6",
  fact_check: "\uf0c5",
  fingerprint: "\ue90d",
  forward_to_inbox: "\uf187",
  group: "\uea21",
  groups: "\uf233",
  history: "\ue8b3",
  info: "\ue88e",
  insights: "\uf092",
  inventory_2: "\ue1a1",
  link: "\ue250",
  lock: "\ue899",
  logout: "\ue9ba",
  mail: "\ue159",
  mark_email_read: "\uf18c",
  mark_email_unread: "\uf18a",
  monitor_heart: "\ueaa2",
  notifications_active: "\ue7f7",
  open_in_new: "\ue89e",
  outgoing_mail: "\uf0d2",
  pause: "\ue034",
  person: "\uf0d3",
  play_arrow: "\ue037",
  policy: "\uea17",
  refresh: "\ue5d5",
  rule: "\uf1c2",
  schedule: "\uefd6",
  schedule_send: "\uea0a",
  search: "\uef7a",
  send: "\ue163",
  settings: "\ue8b8",
  shield: "\ue9e0",
  speed: "\ue9e4",
  store: "\ue8d1",
  storefront: "\uea12",
  task_alt: "\ue2e6",
  trending_up: "\ue8e5",
  tune: "\ue429",
  unsubscribe: "\ue0eb",
  upload_file: "\ue9fc",
  verified: "\uef76",
  verified_user: "\uf013",
  visibility: "\ue8f4",
  warning: "\uf083",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className = "" }: {
  name: IconName; size?: number; className?: string;
}) {
  return (
    <span aria-hidden className={`msi shrink-0 inline-flex items-center justify-center ${className}`}
      style={{ fontSize: size, width: size, height: size }}>
      {ICONS[name]}
    </span>
  );
}
