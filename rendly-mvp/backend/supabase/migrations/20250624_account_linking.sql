-- Account linking (one person = one account across GitHub, LinkedIn and email/password).
-- Run first. Safe to run more than once.
--
-- email_verified: true once a provider (GitHub primary verified email / LinkedIn
-- email_verified=true) has proven ownership of users.email. Password sign-ups start false.
-- When an OAuth identity is linked onto an account whose email is NOT verified and that has a
-- password, the auth-service clears password_hash (pre-account-takeover guard).

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- Normalise stored emails (trim + lowercase). Rows whose normalised email would collide are
-- left untouched here; the unique index in 20250624_account_linking_index.sql will refuse to
-- build until those duplicates are resolved manually.
UPDATE users u
SET email = lower(btrim(u.email))
WHERE u.email IS NOT NULL
  AND u.email <> lower(btrim(u.email))
  AND NOT EXISTS (
    SELECT 1 FROM users o
    WHERE o.id <> u.id AND o.email IS NOT NULL AND lower(btrim(o.email)) = lower(btrim(u.email))
  );

-- Blank emails become NULL so they never match or collide.
UPDATE users SET email = NULL WHERE email IS NOT NULL AND btrim(email) = '';

-- Accounts created through GitHub or LinkedIn got their email from that provider, so treat it as
-- verified. Without this, linking a second provider would wipe a password such a user set later.
UPDATE users
SET email_verified = true
WHERE email_verified = false
  AND email IS NOT NULL
  AND (github_id IS NOT NULL OR linkedin_id IS NOT NULL);
