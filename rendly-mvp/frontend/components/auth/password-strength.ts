export const MIN_PASSWORD_LENGTH = 8;

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

const LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/** Lightweight strength estimate for UI hints only. The server enforces the minimum length. */
export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 1, label: 'Too short' };
  let points = 1;
  if (password.length >= 12) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) points += 1;
  else if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) points += 0.5;
  const score = Math.min(4, Math.floor(points)) as PasswordStrength['score'];
  return { score, label: LABELS[score] };
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'rediffmail.com',
  'qq.com',
  '163.com',
  '126.com',
]);
const FREE_EMAIL_BRANDS = ['yahoo', 'hotmail', 'outlook', 'live', 'gmail', 'gmx', 'yandex', 'proton', 'protonmail'];

/** Client-side pre-check so the user sees the hint before submitting. The server is authoritative. */
export function looksLikePersonalEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  if (FREE_EMAIL_DOMAINS.has(domain)) return true;
  const first = domain.split('.')[0];
  return domain.includes('.') && FREE_EMAIL_BRANDS.includes(first);
}

export function isEmailShaped(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}
