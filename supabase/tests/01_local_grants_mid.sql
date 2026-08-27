-- ТОЛЬКО для локальной проверки (см. 00_local_auth_shim_pre.sql).
-- Настоящий Supabase-проект уже создаёт anon/authenticated с широкими
-- базовыми GRANT на schema public при создании проекта — RLS остаётся
-- единственным реальным барьером. Здесь воспроизводим это же состояние на
-- голой локальной Postgres ПЕРЕД применением RLS-миграции, которая затем
-- сознательно отзывает insert/update/delete на игровых таблицах.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;

-- service_role в реальном Supabase имеет bypassrls и полный доступ.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
