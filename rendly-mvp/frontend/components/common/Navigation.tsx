import Link from 'next/link';

type NavItem = { href: string; label: string };

/** Horizontal text navigation built from ghost buttons. */
export default function Navigation({ items = [] }: { items?: NavItem[] }) {
  return (
    <nav className="flex items-center gap-1" aria-label="Primary">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className="rd-btn rd-btn--ghost rd-btn--sm">
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
