"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Brand, Arrow, Check } from "./brand";
import { Icon, type IconName } from "@/components/icon";

type Links = { crm: string; login: string; home: string; demoEmail: string; demoPassword: string };
type Category = "All medicines" | "Tablets" | "Capsules" | "Vitamins";
type Medicine = { name: string; category: Exclude<Category, "All medicines">; label: string; sku: string; stock: number; color: string; pale: string; form: "box" | "bottle"; tag: string };
const medicines: Medicine[] = [
  { name: "Paracetamol", category: "Tablets", label: "TABLETS", sku: "PF-001", stock: 240, color: "#28594b", pale: "#e7eee5", form: "box", tag: "Everyday essential" },
  { name: "Amoxicillin", category: "Capsules", label: "CAPSULES", sku: "PF-002", stock: 180, color: "#52759a", pale: "#e9eef3", form: "box", tag: "Capsule range" },
  { name: "Vitamin C", category: "Vitamins", label: "VITAMIN TABLETS", sku: "PF-003", stock: 120, color: "#a17736", pale: "#f3ecdf", form: "bottle", tag: "Wellness collection" },
  { name: "Metformin", category: "Tablets", label: "TABLETS", sku: "PF-004", stock: 96, color: "#73638d", pale: "#eeebf2", form: "box", tag: "Pharmacy range" },
  { name: "Cetirizine", category: "Tablets", label: "TABLETS", sku: "PF-005", stock: 48, color: "#56857e", pale: "#e7efec", form: "box", tag: "Everyday essential" },
  { name: "Omeprazole", category: "Capsules", label: "CAPSULES", sku: "PF-006", stock: 160, color: "#a36455", pale: "#f3e9e4", form: "box", tag: "Capsule range" },
];
const categories: Category[] = ["All medicines", "Tablets", "Capsules", "Vitamins"];
const benefits: { icon: IconName; title: string; text: string }[] = [
  { icon: "inventory_2", title: "A range for your shelves", text: "From everyday medicines to wellness essentials, explore a range built around pharmacy procurement." },
  { icon: "storefront", title: "Pharmacy comes first", text: "A wholesale partner focused on the businesses that care for our communities, every day." },
  { icon: "groups", title: "A more personal partnership", text: "Keep your pharmacy relationship at the heart of supply, with a dedicated business workspace." },
];

function MedicinePack({ medicine, className = "" }: { medicine: Medicine; className?: string }) {
  return <div className={`pf-pack pf-pack-${medicine.form} ${className}`} style={{ "--pack-color": medicine.color, "--pack-pale": medicine.pale } as CSSProperties} aria-hidden="true">
    {medicine.form === "bottle" && <div className="pf-bottle-cap"/>}
    <div className="pf-pack-face">
      <span className="pf-pack-brand"><svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M7 1h6v6h6v6h-6v6H7v-6H1V7h6Z"/></svg> pharmacyfirst.</span>
      <div className="pf-pack-name">{medicine.name}<span>{medicine.label}</span></div>
      <div className="pf-pack-band"><span>PHARMACY RANGE</span><svg viewBox="0 0 64 38" fill="none"><rect x="4" y="4" width="52" height="22" rx="11" transform="rotate(13 4 4)" stroke="currentColor"/><path d="m31 9-5 22" stroke="currentColor"/></svg></div>
      <span className="pf-pack-base">ILLUSTRATIVE PACKAGING</span>
    </div>
  </div>;
}

export function Credentials({ email = "", password = "" }: { email?: string; password?: string }) {
  const [copied, setCopied] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(""), 2200);
    } catch { setCopied("Select the credential text to copy it."); }
  };
  if (!email || !password) return <p>Open the original sign-in screen with your existing CRM account.</p>;
  return <div className="pf-credentials">
    {[["Demo email", email], ["Demo password", password]].map(([label, value]) => <div className="pf-credential" key={label}>
      <span>{label}</span><div><code>{value}</code><button type="button" onClick={() => copy(value, `${label} copied`)} aria-label={`Copy ${label.toLowerCase()}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button></div>
    </div>)}
    <span className="pf-copy-status" role="status">{copied || "Public demo credentials · no account needed"}</span>
  </div>;
}

export function Landing({ links }: { links: Links }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState<Category>("All medicines");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Medicine | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const filtered = medicines.filter(m => (category === "All medicines" || m.category === category) && `${m.name} ${m.category}`.toLowerCase().includes(search.trim().toLowerCase()));
  const closeMenu = () => setMenuOpen(false);

  return <main className="pf-site">
    <a className="pf-skip" href="#main-content">Skip to content</a>
    <div className="pf-announcement"><div className="pf-container"><span>Medicine wholesale. <strong>With your pharmacy in mind.</strong></span><a href="#demo">Explore the B2B demo <Arrow/></a></div></div>
    <header className="pf-header"><div className="pf-container pf-header-inner">
      <Link href={links.home} aria-label="Pharmacy First home"><Brand/></Link>
      <nav id="pf-main-nav" className={`pf-nav ${menuOpen ? "is-open" : ""}`} aria-label="Main navigation"><a href="#medicines" onClick={closeMenu}>Our medicines</a><a href="#why-us" onClick={closeMenu}>Why Pharmacy First</a><a href="#stock" onClick={closeMenu}>Stock preview</a><a className="pf-mobile-crm" href={links.crm}>Open CRM <Arrow diagonal/></a></nav>
      <div className="pf-header-actions"><a className="pf-crm-link" href={links.crm}>Open CRM <Arrow diagonal/></a><a className="pf-button pf-button-small" href={links.login}>B2B demo login <Arrow/></a><button type="button" className="pf-menu-button" aria-controls="pf-main-nav" aria-expanded={menuOpen} aria-label={menuOpen ? "Close navigation" : "Open navigation"} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "tune"} size={22}/></button></div>
    </div></header>
    <section className="pf-hero pf-container" id="main-content">
      <div className="pf-hero-copy"><span className="pf-eyebrow"><span className="pf-status-dot"/> YOUR PHARMACY. OUR PRIORITY.</span><h1>Behind every<br/>well-stocked<br/>pharmacy.<span>There’s a partner.</span></h1><p>Medicines for your shelves. A partnership for your business. Discover wholesale supply built around the needs of your pharmacy.</p><div className="pf-hero-buttons"><a className="pf-button" href="#medicines">Explore our medicines <Arrow/></a><a className="pf-text-link" href={links.login}>B2B demo login <Arrow diagonal/></a></div><div className="pf-hero-reassurance"><Check>Medicine wholesale</Check><Check>Made for pharmacies</Check></div></div>
      <div className="pf-hero-visual" aria-label="Illustrative medicine range and sample stock preview">
        <div className="pf-visual-ring pf-ring-one"/><div className="pf-visual-ring pf-ring-two"/><span className="pf-visual-label">THE EVERYDAY ESSENTIALS COLLECTION</span>
        <div className="pf-hero-stock"><span className="pf-stock-icon"><Icon name="inventory_2" size={20}/></span><div><strong>A shelf-ready selection</strong><span>Explore our sample medicine range</span></div><span className="pf-stock-check"><Icon name="check_circle" size={19}/></span></div>
        <div className="pf-hero-packs"><MedicinePack medicine={medicines[1]} className="pf-hero-pack-back"/><MedicinePack medicine={medicines[0]} className="pf-hero-pack-front"/><MedicinePack medicine={medicines[2]} className="pf-hero-pack-bottle"/></div>
        <div className="pf-hero-collection"><span className="pf-collection-cross">+</span><div><strong>Good care starts<br/>with the right supply.</strong><span>PHARMACY FIRST. ALWAYS.</span></div></div><span className="pf-visual-disclaimer">Illustrative packaging · sample catalog</span>
      </div>
    </section>
    <div className="pf-service-strip"><div className="pf-container"><span className="pf-strip-intro">A WHOLESALE PARTNER.<strong>A pharmacy-first approach.</strong></span><span><Icon name="inventory_2" size={22}/> Everyday medicines</span><span><Icon name="storefront" size={22}/> Pharmacy supply</span><span><Icon name="groups" size={22}/> B2B relationships</span><span><Icon name="monitor_heart" size={22}/> Wellness essentials</span></div></div>
    <section className="pf-section pf-container" id="medicines">
      <div className="pf-section-heading"><div><span className="pf-eyebrow">THE RANGE BEHIND YOUR COUNTER</span><h2>Everyday essentials.<br/><span>All in good company.</span></h2></div><div className="pf-heading-aside"><p>A look at the medicines and wellness products in our wholesale range.</p><span className="pf-sample-label"><span className="pf-status-dot"/> SAMPLE CATALOG & STOCK</span></div></div>
      <div className="pf-catalog-controls"><div className="pf-filters" role="group" aria-label="Medicine categories">{categories.map(c => <button type="button" key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>)}</div><label className="pf-search"><Icon name="search" size={19}/><input type="search" aria-label="Search medicines" placeholder="Find a medicine…" value={search} onChange={e => setSearch(e.target.value)}/></label></div>
      <div className="pf-catalog-summary"><span role="status">Showing {filtered.length} of {medicines.length} featured medicines</span><span>Illustrative stock. Not live availability.</span></div>
      <div className="pf-product-grid">{filtered.map(medicine => <article className="pf-product-card" key={medicine.sku}>
        <div className="pf-product-art" style={{ "--art-bg": medicine.pale } as CSSProperties}><span className="pf-product-tag">{medicine.tag}</span><MedicinePack medicine={medicine}/><span className="pf-art-note">ILLUSTRATIVE PACK</span><button type="button" className="pf-product-quick" aria-label={`View ${medicine.name} details`} onClick={() => setSelected(medicine)}><Arrow diagonal/></button></div>
        <div className="pf-product-info"><div className="pf-product-type">{medicine.category}<span>{medicine.sku}</span></div><h3>{medicine.name}</h3><div className="pf-product-bottom"><span className={`pf-availability ${medicine.stock < 50 ? "is-limited" : ""}`}><i/>{medicine.stock < 50 ? "Limited sample stock" : "In sample stock"}</span><span>{medicine.stock} packs</span></div><button type="button" className="pf-product-link" onClick={() => setSelected(medicine)}>View medicine <Arrow/></button></div>
      </article>)}</div>
      {filtered.length === 0 && <div className="pf-empty"><Icon name="search" size={30}/><h3>No medicines found</h3><p>Try another name or browse the full sample range.</p><button type="button" className="pf-button pf-button-small" onClick={() => { setCategory("All medicines"); setSearch(""); }}>Show all medicines <Arrow/></button></div>}
      <div className="pf-catalog-footnote"><Icon name="info" size={17}/><p>This is a product showcase. Names, packaging, and stock quantities are for demonstration; they are not a live offer or an ordering service.</p></div>
    </section>
    <section className="pf-partner-section" id="why-us"><div className="pf-container"><div className="pf-partner-heading"><span className="pf-eyebrow">MORE THAN MEDICINES</span><h2>Your shelves matter.<br/><span>So does your business.</span></h2><p>Independent pharmacies do more than dispense medicines. They support entire communities. We put the business behind that care first.</p><a className="pf-inline-link" href="#demo">Meet your B2B workspace <Arrow/></a></div><div className="pf-benefits">{benefits.map((benefit, i) => <article key={benefit.title}><span className="pf-benefit-icon"><Icon name={benefit.icon} size={26}/></span><div><span className="pf-benefit-number">0{i + 1}</span><h3>{benefit.title}</h3><p>{benefit.text}</p></div></article>)}</div></div></section>
    <section className="pf-section pf-container pf-stock-section" id="stock"><div className="pf-stock-copy"><span className="pf-eyebrow">A CLEARER VIEW OF YOUR NEXT RESTOCK</span><h2>Your essentials.<br/><span>At a glance.</span></h2><p>Explore a sample of the range your pharmacy relies on. Product categories and pack availability, together in one easy view.</p><div className="pf-stock-key"><span><i/>Available in the sample</span><span><i className="is-amber"/>Limited in the sample</span></div><a className="pf-button pf-button-outline" href="#medicines">Browse featured medicines <Arrow/></a><p className="pf-small-note">All quantities shown are fictional demo stock.</p></div><div className="pf-stock-board"><div className="pf-board-heading"><span><Icon name="inventory_2" size={20}/> Stock overview</span><span className="pf-sample-label">DEMO DATA</span></div><div className="pf-board-columns"><span>MEDICINE / CATEGORY</span><span>SAMPLE PACKS</span></div>{[medicines[0], medicines[1], medicines[4], medicines[2]].map((m, i) => <div className="pf-stock-row" key={m.sku}><span className="pf-stock-row-icon" style={{ color: m.color, background: m.pale }}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="7" y="2" width="10" height="20" rx="5" transform={i % 2 ? "rotate(35 12 12)" : "rotate(-35 12 12)"}/><path d={i % 2 ? "m8 9 8 6" : "m8 15 8-6"}/></svg></span><div><strong>{m.name}</strong><span>{m.category} · {m.sku}</span></div><div className="pf-stock-quantity"><strong>{m.stock}<small> packs</small></strong><div><span style={{ width: `${m.stock / 2.4}%`, background: m.stock < 50 ? "#c8984b" : "#72917b" }}/></div></div></div>)}<div className="pf-board-footer"><span className="pf-status-dot"/>Sample availability preview<a href="#medicines">View range <Arrow/></a></div></div></section>
    <section className="pf-demo-section pf-container" id="demo"><div className="pf-demo-intro"><span className="pf-eyebrow"><span className="pf-status-dot"/> YOUR B2B DEMO ACCESS</span><h2>Come on in.<br/>Your business<br/><span>belongs here.</span></h2><p>Take a look inside our business workspace. The B2B demo opens the original CRM, with sample pharmacy profiles, business relationships, and conversations ready to explore.</p><div className="pf-demo-promises"><Check>Original CRM interface</Check><Check>Sample pharmacy records</Check><Check>No setup needed</Check></div><div className="pf-demo-signoff"><Brand/><span>For the business of better pharmacy.</span></div></div><div className="pf-demo-access"><div className="pf-access-top"><span className="pf-access-icon"><Icon name="fingerprint" size={27}/></span><span className="pf-access-pill">DISPLAY-ONLY DEMO</span></div><h3>A little look behind the counter.</h3><p>Use the public details below to try the original login.</p><Credentials email={links.demoEmail} password={links.demoPassword}/><a className="pf-button pf-button-lime" href={links.login}>B2B demo login <Arrow/></a><a className="pf-demo-direct" href={links.crm}>Open the original CRM directly <Arrow diagonal/></a><div className="pf-demo-disclosure"><Icon name="info" size={17}/><p>A display-only preview with fictional data. Orders, payments, saving, sending, uploads, and external connections are disabled.</p></div></div></section>
    <section className="pf-section pf-container pf-faq" id="faq"><div><span className="pf-eyebrow">GOOD TO KNOW</span><h2>A few questions.<br/><span>A little clarity.</span></h2><p>Everything you need before taking a look around.</p></div><div className="pf-faq-list">{[
      ["Who is Pharmacy First for?", "Pharmacy First is a medicine wholesale business serving pharmacies. This website introduces the product range and gives pharmacy businesses a look at the B2B workspace."],
      ["Are the medicine stocks on this page live?", "No. The featured medicines, packaging, product codes, and stock quantities are illustrative demo content. They do not confirm actual availability, pricing, or supply terms."],
      ["Can I place an order in the demo?", "This is a visual demo. You can browse the sample catalog and explore the original CRM, but orders, payments, saving, and live communications are disabled."],
      ["How do I open the B2B demo?", "Choose B2B demo login and use the public credentials shown above. The login opens the original CRM interface. You can also choose Open CRM in the header to explore it directly."],
    ].map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>
    <footer className="pf-footer"><div className="pf-container pf-footer-top"><div><Link href={links.home} aria-label="Pharmacy First home"><Brand/></Link><p>Behind your shelves.<br/>Beside your business.</p><span className="pf-footer-caption">MEDICINE WHOLESALE FOR PHARMACIES</span></div><div><span>EXPLORE THE RANGE</span><a href="#medicines">Featured medicines</a><a href="#stock">Sample stock</a><a href="#why-us">Why Pharmacy First</a></div><div><span>YOUR BUSINESS</span><a href={links.login}>B2B demo login <Arrow diagonal/></a><a href={links.crm}>Original CRM <Arrow diagonal/></a><a href="#demo">Demo login details</a><a href="#faq">Common questions</a></div><div className="pf-footer-message"><span className="pf-status-dot"/>Your pharmacy.<br/><strong>Always first.</strong></div></div><div className="pf-container pf-footer-bottom"><span>© 2026 Pharmacy First.</span><span>Display-only showcase · sample catalog and stock</span><a href="#main-content">Back to top ↑</a></div></footer>
    <dialog className="pf-product-dialog" ref={dialog} aria-labelledby="pf-product-title" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      {selected && <div className="pf-dialog-content"><button type="button" className="pf-dialog-close" aria-label="Close medicine details" onClick={() => dialog.current?.close()}><Icon name="close" size={22}/></button><div className="pf-dialog-art" style={{ background: selected.pale }}><MedicinePack medicine={selected}/><span>ILLUSTRATIVE PACKAGING</span></div><div className="pf-dialog-copy"><span className="pf-eyebrow">SAMPLE WHOLESALE CATALOG</span><h2 id="pf-product-title">{selected.name}</h2><p>{selected.category} · {selected.sku}</p><dl><div><dt>Sample stock</dt><dd>{selected.stock} packs</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Availability</dt><dd>Demonstration only</dd></div></dl><p className="pf-dialog-note">Fictional stock and illustrative packaging. This preview does not offer medicines for sale or confirm product specifications.</p><a className="pf-button" href={links.login}>Explore the B2B demo <Arrow/></a></div></div>}
    </dialog>
  </main>;
}
