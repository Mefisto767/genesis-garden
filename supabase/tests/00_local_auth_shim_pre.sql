-- ============================================================================
-- ТОЛЬКО для локальной проверки миграций на голом Postgres (без полного
-- Supabase-стека — в песочнице разработки нет доступа к Docker). Реальный
-- Supabase-проект уже предоставляет схему auth и роли anon/authenticated/
-- service_role "из коробки" — этот файл НЕ применяется на реальном проекте,
-- он существует только чтобы честно прогнать SQL-миграции и RLS-тесты здесь.
--
-- Подделывает ровно то поведение Supabase, от которого зависят миграции:
--   - схема auth с таблицей users и функцией auth.uid(), читающей GUC
--     request.jwt.claim.sub (тот же механизм, что использует настоящий
--     Supabase/PostgREST через `set_config`);
--   - роли anon/authenticated/service_role.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public, auth to anon, authenticated, service_role;
