import { ArrowUpRight, Menu, X } from "lucide-react";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/react";
import { useState, type ReactNode } from "react";

export const publicAssets = {
  logo: "/images/heatcheck-mark.svg",
  terrain: "/images/thermal-terrain.webp",
  urbanScan: "/images/urban-heat.webp",
  operations: "/images/thermal-operations.webp",
  layers: "/images/environmental-layers.webp",
};

const links = [
  { label: "Platform", href: "/platform" },
  { label: "Intelligence", href: "/intelligence" },
  { label: "Solutions", href: "/solutions" },
  { label: "Company", href: "/company" },
];

export function PublicAction({ href = "/app", children, subtle = false }: { href?: string; children: ReactNode; subtle?: boolean }) {
  return <a className={`public-action ${subtle ? "public-action--subtle" : ""}`} href={href}><span>{children}</span><ArrowUpRight size={16} /></a>;
}

export function PublicShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="public-shell">
    <header className="public-nav"><a href="/" className="public-brand"><img src={publicAssets.logo} alt="" /><span>Heatcheck</span></a><nav aria-label="Primary navigation">{links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</nav><div className="public-nav__actions"><Show when="signed-out"><SignInButton mode="modal"><button type="button" className="public-signin">Sign in</button></SignInButton><SignUpButton mode="modal"><button type="button" className="public-action"><span>Start Heatcheck</span><ArrowUpRight size={16} /></button></SignUpButton></Show><Show when="signed-in"><a href="/app" className="public-signin">Workspace</a><UserButton /></Show><button type="button" className="public-menu" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen((value) => !value)}>{open ? <X /> : <Menu />}</button></div></header>
    {open && <div className="public-mobile-nav"><nav aria-label="Mobile navigation">{links.map((link) => <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}<ArrowUpRight /></a>)}<Show when="signed-out"><SignInButton mode="modal"><button type="button" onClick={() => setOpen(false)}>Sign in <ArrowUpRight /></button></SignInButton><SignUpButton mode="modal"><button type="button" onClick={() => setOpen(false)}>Create account <ArrowUpRight /></button></SignUpButton></Show><Show when="signed-in"><a href="/app" onClick={() => setOpen(false)}>Open operations <ArrowUpRight /></a></Show></nav></div>}
    {children}
    <footer className="public-footer"><div><a href="/" className="public-brand"><img src={publicAssets.logo} alt="" /><span>Heatcheck</span></a><p>Autonomous heat intelligence for operations that cannot wait.</p></div><div className="public-footer__links"><div><span>Explore</span>{links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</div><div><span>Operations</span><a href="/app">Secure workspace</a><a href="mailto:hello@heatcheck.ai">Field briefing</a></div></div><small>© 2026 Heatcheck · Autonomous Heat Intelligence</small></footer>
  </div>;
}
