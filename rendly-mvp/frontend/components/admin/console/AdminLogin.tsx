'use client';

/** Admin sign-in. Credentials are checked by auth-service; nothing is stored but the session token. */
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnoryxSignature, RendlyLockup } from '@/components/brand/Brand';
import { adminLogin, getAdminToken } from '@/lib/adminApi';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getAdminToken()) router.replace('/admin/dashboard');
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter the admin email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminLogin(email.trim(), password);
      setPassword('');
      router.replace('/admin/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="al-page">
      <div className="al-glow" aria-hidden />
      <form className="al-card" onSubmit={onSubmit} noValidate>
        <RendlyLockup />
        <h1>Admin console</h1>
        <p className="al-sub">Restricted to the Rendly team. Every sign-in attempt is logged.</p>
        <label className="al-field">
          <span>Admin email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="al-field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="al-error" role="alert">{error}</p>}
        <button type="submit" className="al-btn" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="al-foot">
          <AnoryxSignature />
        </div>
      </form>
    </div>
  );
}
