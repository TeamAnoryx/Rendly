-- Security lock-down (audit of 2026-11-20). Safe to run more than once. Changes no data.
--
-- Why: the backend talks to the database with the service-role key (and a direct Postgres
-- connection). Nothing else should. But 15 tables had no row level security, and several
-- tables and functions were explicitly granted to the public API roles (anon, authenticated):
-- whisper_messages and group_messages (every private message), the two message-thread
-- functions (which take any user id as an argument), connections, blocks, reports, contact
-- requests and more. Anyone holding the project's anon key could read or change them through
-- the Supabase REST API, bypassing the app entirely.
--
-- What this does:
--   1. Turns on row level security for every table in schema public. With no policies, the
--      API roles see nothing; the service role and the table owner are not affected.
--   2. Revokes every table, view, sequence and function privilege in schema public from
--      anon, authenticated and PUBLIC, and keeps EXECUTE for service_role.
--   3. Stops future tables/functions from being granted to the API roles by default.
--   4. Drops the chat-media storage policy that had no role and so applied to everyone.
--
-- BEFORE RUNNING: both backend services must use SUPABASE_SERVICE_ROLE_KEY (not the anon
-- key). The code falls back to SUPABASE_ANON_KEY when the service key is missing; with that
-- fallback in use, this migration would cut the backend off from its own data.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- 1 + 2a. Tables: RLS on, API-role privileges off.
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.tablename);
  END LOOP;

  -- 2b. Views (they run with their owner's rights, so a grant alone would expose the data).
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.viewname);
  END LOOP;

  -- 2c. Sequences.
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated', r.sequencename);
  END LOOP;

  -- 2d. Functions and procedures the project created (extension-owned ones are left alone).
  FOR r IN
    SELECT p.oid::regprocedure AS signature, p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    IF r.prokind = 'p' THEN
      EXECUTE format('REVOKE ALL ON PROCEDURE %s FROM PUBLIC, anon, authenticated', r.signature);
      EXECUTE format('GRANT EXECUTE ON PROCEDURE %s TO service_role', r.signature);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
    END IF;
  END LOOP;
END $$;

-- The service role keeps full access to everything it already uses.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 3. New objects created by migrations are private by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- 4. chat-media: the old policy named no role, so it gave every API role read, write and
-- delete on private chat files. The service role bypasses row level security and needs no policy.
DROP POLICY IF EXISTS "Service role full access chat-media" ON storage.objects;

-- Check (read-only): both queries should return zero rows after this migration.
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
