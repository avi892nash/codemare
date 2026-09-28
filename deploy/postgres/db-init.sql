-- Codemare database bootstrap. Run by the `db-init` one-shot service (as the
-- Postgres superuser) on every `docker compose up`, before web and Directus
-- start. Idempotent: it converges roles, schema ownership and grants to the
-- state below and never touches table data.
--
-- Who may do what (deploy/README.md, "Directus and Prisma"):
--   codemare         owns the database and the `app` + `content` schemas.
--                    web connects as it; Prisma migrations (the only DDL for
--                    app/content) run as it; `_prisma_migrations` lives in public.
--   directus         owns the `directus` schema (its directus_* system
--                    tables) and has row-level DML on content.* only: no
--                    CREATE on content, not the owner of any content table (so
--                    no ALTER/DROP), and nothing at all on app.* or public.
--   codemare_backup  read-only (pg_read_all_data) for the nightly pg_dump.
--
-- Inputs (psql \getenv): CODEMARE_DB, CODEMARE_DB_PASSWORD,
-- DIRECTUS_DB_PASSWORD, BACKUP_DB_PASSWORD.

\set ON_ERROR_STOP on
\set QUIET on

\set db_name ''
\set app_password ''
\set directus_password ''
\set backup_password ''
\getenv db_name CODEMARE_DB
\getenv app_password CODEMARE_DB_PASSWORD
\getenv directus_password DIRECTUS_DB_PASSWORD
\getenv backup_password BACKUP_DB_PASSWORD

SELECT :'db_name' = '' OR :'app_password' = '' OR :'directus_password' = '' OR :'backup_password' = ''
    AS missing_input \gset
\if :missing_input
  DO $$ BEGIN RAISE EXCEPTION 'db-init: CODEMARE_DB, CODEMARE_DB_PASSWORD, DIRECTUS_DB_PASSWORD and BACKUP_DB_PASSWORD must all be set'; END $$;
\endif

SELECT current_database() <> :'db_name' AS wrong_db \gset
\if :wrong_db
  DO $$ BEGIN RAISE EXCEPTION 'db-init: connected to the wrong database (PGDATABASE must equal CODEMARE_DB)'; END $$;
\endif

-- ── roles ──────────────────────────────────────────────────────────────────
SELECT format('CREATE ROLE %I LOGIN', r)
  FROM unnest(ARRAY['codemare', 'directus', 'codemare_backup']) AS r
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) \gexec

ALTER ROLE codemare        LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE directus        LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'directus_password';
ALTER ROLE codemare_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backup_password';
GRANT pg_read_all_data TO codemare_backup;

-- Directus resolves unqualified names through its search path: its own
-- tables first, then the content tables. (DB_SEARCH_PATH says the same.)
ALTER ROLE directus SET search_path = directus, content;

-- ── database ───────────────────────────────────────────────────────────────
SELECT format('ALTER DATABASE %I OWNER TO codemare', :'db_name') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO codemare, directus, codemare_backup', :'db_name') \gexec
-- PG15+ default, stated explicitly: nobody but the owner creates in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ── schemas ────────────────────────────────────────────────────────────────
-- Created here (Prisma's init migration uses CREATE SCHEMA IF NOT EXISTS, so
-- it is a no-op afterwards) so that content's default privileges exist
-- before the first table does.
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION codemare;
CREATE SCHEMA IF NOT EXISTS content AUTHORIZATION codemare;
CREATE SCHEMA IF NOT EXISTS directus AUTHORIZATION directus;

REVOKE ALL ON SCHEMA app, content FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM directus;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM directus;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM directus;

-- ── Directus on content: rows only ─────────────────────────────────────────
GRANT USAGE ON SCHEMA content TO directus;
REVOKE CREATE ON SCHEMA content FROM directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content TO directus;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA content TO directus;
-- Tables and sequences future migrations create (as codemare) get the same.
ALTER DEFAULT PRIVILEGES FOR ROLE codemare IN SCHEMA content
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO directus;
ALTER DEFAULT PRIVILEGES FOR ROLE codemare IN SCHEMA content
  GRANT USAGE, SELECT ON SEQUENCES TO directus;

\echo 'db-init: roles, schemas and grants are in place'
