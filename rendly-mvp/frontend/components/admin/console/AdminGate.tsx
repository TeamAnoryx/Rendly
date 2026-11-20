'use client';

/**
 * Admin shell. `/admin` is the sign-in page (no navigation); every other admin page needs an
 * admin session and sends the visitor back to `/admin` without one.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import AdminNav from '@/components/admin/AdminNav';
import { adminFetch, getAdminToken, setAdminToken } from '@/lib/adminApi';

export default function AdminGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const router = useRouter();
  const isLogin = pathname === '/admin' || pathname === '/admin/';
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (isLogin) return;
    if (!getAdminToken()) {
      router.replace('/admin');
      return;
    }
    let cancelled = false;
    adminFetch<{ email: string }>('/api/admin/me')
      .then((me) => !cancelled && setEmail(me.email))
      .catch(() => !cancelled && router.replace('/admin'));
    const onSignedOut = () => router.replace('/admin');
    window.addEventListener('rendly-admin-signed-out', onSignedOut);
    return () => {
      cancelled = true;
      window.removeEventListener('rendly-admin-signed-out', onSignedOut);
    };
  }, [isLogin, pathname, router]);

  if (isLogin) return <>{children}</>;
  if (!email) {
    return (
      <div className="adm-gate-wait" aria-live="polite">
        <span className="adm-spinner" aria-hidden /> Checking your admin session…
      </div>
    );
  }
  return (
    <div className="adm-shell">
      <AdminNav
        email={email}
        onSignOut={() => {
          setAdminToken(null);
          router.replace('/admin');
        }}
      />
      <main className="adm-main">{children}</main>
    </div>
  );
}
