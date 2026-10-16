"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { Brand, Arrow, Check } from "./brand";
import { Icon } from "@/components/icon";

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
const benefits = [
  { title: "Medicines", text: "Tablets and capsules across a selection of everyday pharmacy lines." },
  { title: "Health & wellness", text: "Vitamins and wellness essentials alongside your medicine range." },
  { title: "Pharmacy business", text: "A B2B workspace for pharmacy profiles, contacts, and business relationships." },
];

function MedicinePack({ medicine, className = "" }: { medicine: Medicine; className?: string }) {
  return <div className={`pf-pack pf-pack-${medicine.form} ${className}`} style={{ "--pack-color": medicine.color, "--pack-pale": medicine.pale } as CSSProperties} aria-hidden="true">
    {medicine.form === "bottle" && <div className="pf-bottle-cap"/>}
    <div className="pf-pack-face">
      <span className="pf-pack-brand"><svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M7 1h6v6h6v6h-6v6H7v-6H1V7h6Z"/></svg> expressdiabetics.</span>
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
  useEffect(() => {
    if (!selected) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [selected]);
  const filtered = medicines.filter(m => (category === "All medicines" || m.category === category) && `${m.name} ${m.category}`.toLowerCase().includes(search.trim().toLowerCase()));
  const closeMenu = () => setMenuOpen(false);

  return <main className="pf-site">
    <a className="pf-skip" href="#main-content">Skip to content</a>
    <div className="pf-utility">
      <div className="pf-container">
        <span>Pharmaceutical wholesale for pharmacy businesses</span>
        <div><span>Product showcase · Demo stock</span><a href="#faq">Help & information</a></div>
      </div>
    </div>
    <header className="pf-header">
      <div className="pf-container pf-header-inner">
        <Link className="pf-brand-link" href={links.home} aria-label="expressdiabetics home">
          <Brand/><span className="pf-brand-descriptor">PHARMACEUTICAL WHOLESALE</span>
        </Link>
        <nav id="pf-main-nav" className={`pf-nav ${menuOpen ? "is-open" : ""}`} aria-label="Main navigation">
          <a href="#medicines" onClick={closeMenu}>Medicines</a>
          <a href="#why-us" onClick={closeMenu}>About us</a>
          <a href="#stock" onClick={closeMenu}>Stock overview</a>
          <a className="pf-mobile-crm" href={links.crm}>Open CRM <Arrow diagonal/></a>
        </nav>
        <div className="pf-header-actions">
          <a className="pf-crm-link" href={links.crm}>Open CRM <Arrow diagonal/></a>
          <a className="pf-button pf-button-small" href={links.login}>B2B demo login <Arrow/></a>
          <button type="button" className="pf-menu-button" aria-controls="pf-main-nav" aria-expanded={menuOpen} aria-label={menuOpen ? "Close navigation" : "Open navigation"} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <Icon name="close" size={23}/> : <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h16M4 12h16M4 17h16"/></svg>}
          </button>
        </div>
      </div>
    </header>

    <section className="pf-hero-section" id="main-content"><div className="pf-hero pf-container">
      <div className="pf-hero-copy">
        <span className="pf-eyebrow">EXPRESSDIABETICS / TRADE SUPPLY</span>
        <h1>Wholesale medicine<span>for your pharmacy.</span></h1>
        <p>Medicines and wellness essentials for pharmacy businesses. Explore our product range and discover a business partner focused on pharmacy supply.</p>
        <div className="pf-hero-buttons">
          <a className="pf-button" href="#medicines">Browse medicines <Arrow/></a>
          <a className="pf-button pf-button-outline" href={links.login}>B2B demo login <Arrow diagonal/></a>
        </div>
        <div className="pf-hero-footnote"><span/>Serving the pharmacy trade</div>
      </div>
      <figure className="pf-hero-image">
        <Image src="/images/pharmacy-professional.webp" alt="A pharmacist checking medicine stock on pharmacy shelves" width={1600} height={1067} priority sizes="(max-width: 760px) 100vw, 50vw"/>
        <figcaption><span>FOCUSED ON PHARMACY</span><span>From medicine supply to business relationships.</span></figcaption>
      </figure>
    </div></section>

    <section className="pf-supply-strip" aria-label="Our supply focus">
      <div className="pf-container">{benefits.map((benefit, i) => <div key={benefit.title}>
        <span className="pf-strip-number">0{i + 1}</span><div><h2>{benefit.title}</h2><p>{benefit.text}</p></div>
      </div>)}</div>
    </section>

    <section className="pf-section pf-container" id="medicines">
      <div className="pf-section-heading">
        <div><span className="pf-eyebrow">PRODUCT CATALOG</span><h2>Featured medicines</h2><p>Browse a selection of medicines and wellness products.</p></div>
        <a className="pf-inline-link" href="#stock">View stock overview <Arrow/></a>
      </div>
      <div className="pf-catalog-controls">
        <div className="pf-filters" role="group" aria-label="Medicine categories">{categories.map(c => <button type="button" key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <label className="pf-search"><Icon name="search" size={20}/><input type="search" aria-label="Search medicines" placeholder="Search the range" value={search} onChange={e => setSearch(e.target.value)}/></label>
      </div>
      <div className="pf-catalog-summary"><span role="status">{filtered.length} medicines</span><span><i/>Demo catalog · Illustrative availability</span></div>
      <div className="pf-product-grid">{filtered.map(medicine => <article className="pf-product-card" key={medicine.sku}>
        <div className="pf-product-art"><MedicinePack medicine={medicine}/><span className="pf-art-note">PRODUCT ILLUSTRATION</span><button type="button" className="pf-product-quick" aria-label={`View ${medicine.name} details`} onClick={() => setSelected(medicine)}><Arrow diagonal/></button></div>
        <div className="pf-product-info">
          <div className="pf-product-type">{medicine.category}<span>{medicine.sku}</span></div>
          <h3>{medicine.name}</h3>
          <div className="pf-product-bottom"><span className={`pf-availability ${medicine.stock < 50 ? "is-limited" : ""}`}><i/>{medicine.stock < 50 ? "Limited sample stock" : "In sample stock"}</span><span>{medicine.stock} packs</span></div>
          <button type="button" className="pf-product-link" onClick={() => setSelected(medicine)}>View medicine <Arrow/></button>
        </div>
      </article>)}</div>
      {filtered.length === 0 && <div className="pf-empty"><Icon name="search" size={28}/><h3>No medicines found</h3><p>Try a different search or browse all categories.</p><button type="button" className="pf-button pf-button-small" onClick={() => { setCategory("All medicines"); setSearch(""); }}>Show all medicines <Arrow/></button></div>}
      <p className="pf-catalog-footnote">Product illustrations and quantities are sample content. Actual products, specifications, and availability are not confirmed by this demo.</p>
    </section>

    <section className="pf-about-section" id="why-us">
      <div className="pf-container pf-about-layout">
        <div><span className="pf-eyebrow">ABOUT EXPRESSDIABETICS</span><h2>A supply business.<br/>Built around pharmacies.</h2></div>
        <div className="pf-about-copy"><p>expressdiabetics supplies medicines to pharmacies. Our focus is straightforward: the products your business needs and the relationships that support it.</p><p>From medicines to wellness products, our range is presented with pharmacy procurement in mind. The B2B demo gives you a look at the business workspace behind those relationships.</p><a className="pf-inline-link" href="#demo">Explore business access <Arrow/></a></div>
      </div>
      <div className="pf-container pf-business-details"><div><span>OUR CUSTOMERS</span><strong>Pharmacy businesses</strong></div><div><span>OUR RANGE</span><strong>Medicines & wellness</strong></div><div><span>OUR FOCUS</span><strong>Wholesale supply</strong></div></div>
    </section>

    <section className="pf-section pf-container pf-stock-section" id="stock">
      <div className="pf-stock-copy"><span className="pf-eyebrow">STOCK AT A GLANCE</span><h2>A clearer view<br/>of the range.</h2><p>Review product categories and sample pack quantities before exploring the business demo.</p><a className="pf-inline-link" href="#medicines">Browse the medicine catalog <Arrow/></a><p className="pf-small-note">Sample quantities only. This is not live stock.</p></div>
      <div className="pf-stock-board">
        <div className="pf-board-heading"><h3>Stock overview</h3><span className="pf-sample-label">DEMO DATA</span></div>
        <div className="pf-stock-table-wrap"><table className="pf-stock-table"><thead><tr><th>Medicine</th><th>Category</th><th>Sample packs</th><th><span className="pf-visually-hidden">Details</span></th></tr></thead><tbody>{[medicines[0], medicines[1], medicines[4], medicines[2]].map(m => <tr key={m.sku}><td><span className={`pf-table-dot ${m.stock < 50 ? "is-limited" : ""}`}/><strong>{m.name}</strong><small>{m.sku}</small></td><td>{m.category}</td><td>{m.stock.toLocaleString()}</td><td><button type="button" aria-label={`Preview ${m.name} stock`} onClick={() => setSelected(m)}><Arrow diagonal/></button></td></tr>)}</tbody></table></div>
        <div className="pf-board-footer"><Icon name="info" size={15}/><span>Stock figures are for presentation purposes.</span></div>
      </div>
    </section>

    <section className="pf-demo-section pf-container" id="demo">
      <div className="pf-demo-intro"><span className="pf-eyebrow">BUSINESS ACCESS</span><h2>Explore the<br/>B2B workspace.</h2><p>Open the original CRM and browse sample pharmacy profiles, contacts, campaigns, and conversations.</p><div className="pf-demo-promises"><Check>Original CRM interface</Check><Check>Prepared sample records</Check><Check>No account setup required</Check></div><a className="pf-demo-direct" href={links.crm}>Open the original CRM <Arrow diagonal/></a></div>
      <div className="pf-demo-access"><div className="pf-access-top"><span className="pf-access-label">DEMO ACCOUNT</span><Icon name="lock" size={18}/></div><h3>B2B demo login</h3><p>Use these public credentials to explore the original sign-in experience.</p><Credentials email={links.demoEmail} password={links.demoPassword}/><a className="pf-button" href={links.login}>B2B demo login <Arrow/></a><p className="pf-demo-disclosure">Display-only demo with fictional records. Changes are not saved and live transactions are disabled.</p></div>
    </section>

    <section className="pf-section pf-container pf-faq" id="faq"><div><span className="pf-eyebrow">INFORMATION</span><h2>Frequently asked<br/>questions</h2><p>About our business and this demonstration.</p></div><div className="pf-faq-list">{[
      ["Who does expressdiabetics supply?", "expressdiabetics is a medicine wholesale business serving pharmacies. This website introduces the product range and provides access to a demonstration of the business workspace."],
      ["Are the medicine stocks on this page live?", "No. Product illustrations, product codes, and stock quantities are sample content. They do not confirm actual availability, pricing, or supply terms."],
      ["Can I place an order in the demo?", "This is a visual demonstration. You can browse the sample catalog and explore the original CRM. Orders, payments, saving, and live communications are disabled."],
      ["How do I access the business demo?", "Select B2B demo login and use the public credentials above. You can also select Open CRM in the header to enter the original CRM directly."],
    ].map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>

    <footer className="pf-footer"><div className="pf-container pf-footer-top"><div><Link href={links.home} aria-label="expressdiabetics home"><Brand/></Link><p>Pharmaceutical wholesale.<br/>Focused on your pharmacy.</p></div><div><span>PRODUCTS</span><a href="#medicines">Medicine catalog</a><a href="#stock">Stock overview</a></div><div><span>COMPANY</span><a href="#why-us">About expressdiabetics</a><a href="#faq">Help & information</a></div><div><span>BUSINESS ACCESS</span><a href={links.login}>B2B demo login <Arrow diagonal/></a><a href={links.crm}>Open original CRM <Arrow diagonal/></a><a href="#demo">Demo account details</a></div></div><div className="pf-container pf-footer-bottom"><span>© 2026 expressdiabetics</span><span>Demonstration website. Product and stock information is illustrative.</span><a href="#main-content">Back to top ↑</a></div></footer>

    <dialog className="pf-product-dialog" ref={dialog} aria-labelledby="pf-product-title" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      {selected && <div className="pf-dialog-content"><button type="button" className="pf-dialog-close" aria-label="Close medicine details" onClick={() => dialog.current?.close()}><Icon name="close" size={22}/></button><div className="pf-dialog-art"><MedicinePack medicine={selected}/><span>PRODUCT ILLUSTRATION</span></div><div className="pf-dialog-copy"><span className="pf-eyebrow">SAMPLE PRODUCT DETAILS</span><h2 id="pf-product-title">{selected.name}</h2><p>{selected.category} · {selected.sku}</p><dl><div><dt>Sample stock</dt><dd>{selected.stock} packs</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Availability</dt><dd>Demo only</dd></div></dl><p className="pf-dialog-note">Illustrative packaging and fictional quantities. Product specifications and supply terms are not confirmed by this demo.</p><a className="pf-button" href={links.login}>Explore the B2B demo <Arrow/></a></div></div>}
    </dialog>
  </main>;
}
