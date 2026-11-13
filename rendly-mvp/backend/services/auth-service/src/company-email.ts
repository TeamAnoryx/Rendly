/**
 * Company (work) email validation for email + password sign-up.
 * Pure module: no I/O, safe to unit test.
 */

export type CompanyEmailResult = { ok: boolean; message?: string };

const EMAIL_PATTERN = /^[^\s@]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_EMAIL_LENGTH = 254;

/** Free consumer webmail providers, matched on the full domain. */
const FREE_WEBMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "passport.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aim.com",
  "protonmail.com",
  "protonmail.ch",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tuta.io",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "mail.com",
  "email.com",
  "usa.com",
  "yandex.com",
  "yandex.ru",
  "ya.ru",
  "mail.ru",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "rambler.ru",
  "zoho.com",
  "zohomail.com",
  "rediffmail.com",
  "qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "yeah.net",
  "sina.com",
  "sohu.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "fastmail.com",
  "fastmail.fm",
  "hushmail.com",
  "lycos.com",
  "rocketmail.com",
  "ymail.com",
  "att.net",
  "comcast.net",
  "verizon.net",
  "btinternet.com",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "libero.it",
  "t-online.de",
  "seznam.cz",
  "wp.pl",
  "o2.pl",
  "interia.pl",
  "bol.com.br",
  "uol.com.br",
]);

/**
 * Providers that operate under many country TLDs (yahoo.co.uk, hotmail.fr, outlook.de ...).
 * Matched on the label right after the "@", or after a leading regional subdomain.
 */
const FREE_WEBMAIL_BRANDS = new Set<string>([
  "yahoo",
  "hotmail",
  "outlook",
  "live",
  "msn",
  "gmail",
  "googlemail",
  "aol",
  "gmx",
  "yandex",
  "protonmail",
  "zoho",
  "rediffmail",
  "rediff",
  "icloud",
]);

/** Disposable / throwaway inbox providers. */
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmail.net",
  "tempmailo.com",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "yopmail.com",
  "yopmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "mintemail.com",
  "mohmal.com",
  "fakeinbox.com",
  "emailondeck.com",
  "mailnesia.com",
  "spamgourmet.com",
  "mytemp.email",
  "burnermail.io",
  "tempinbox.com",
  "discard.email",
  "moakt.com",
  "emailfake.com",
]);

const DISPOSABLE_BRANDS = ["mailinator", "tempmail", "temp-mail", "10minutemail", "guerrillamail", "yopmail", "trashmail"];

const NOT_COMPANY_MESSAGE = "Use your company email address. Personal email providers aren't supported.";
const DISPOSABLE_MESSAGE = "Disposable email addresses aren't supported. Use your company email address.";
const INVALID_MESSAGE = "Enter a valid email address.";

function isFreeWebmail(domain: string): boolean {
  if (FREE_WEBMAIL_DOMAINS.has(domain)) return true;
  const labels = domain.split(".");
  // yahoo.co.uk, hotmail.fr -> first label; uk.yahoo.com style regional subdomains -> second label
  if (labels.length >= 2 && FREE_WEBMAIL_BRANDS.has(labels[0])) return true;
  if (labels.length >= 3 && FREE_WEBMAIL_BRANDS.has(labels[1])) return true;
  return false;
}

function isDisposable(domain: string): boolean {
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  const labels = domain.split(".");
  return DISPOSABLE_BRANDS.some((brand) => labels.slice(0, -1).includes(brand));
}

/** Normalised email (trimmed, lowercased). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Validate that an email is well formed and belongs to a company (not free/disposable) domain. */
export function isCompanyEmail(email: unknown): CompanyEmailResult {
  if (typeof email !== "string") return { ok: false, message: INVALID_MESSAGE };
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    return { ok: false, message: INVALID_MESSAGE };
  }
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (isDisposable(domain)) return { ok: false, message: DISPOSABLE_MESSAGE };
  if (isFreeWebmail(domain)) return { ok: false, message: NOT_COMPANY_MESSAGE };
  return { ok: true };
}
