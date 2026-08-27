-- Seed-данные для ЛОКАЛЬНОЙ разработки (`supabase db reset` применяет этот
-- файл после миграций). НЕ выполняется на реальном проекте автоматически.
-- Каталог (seed_catalog/quests) уже наполнен миграцией
-- 20260827120300_catalog_data.sql — она же и есть prod-контент.
--
-- Здесь — только тестовые auth-пользователи для локальной проверки полного
-- пути руками через Supabase Studio (localhost:54323), без реальной
-- регистрации. Пароль обоих тестовых аккаунтов: "password123".

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'tester1@genesis-garden.local',
    crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    'authenticated', 'authenticated'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'tester2@genesis-garden.local',
    crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    'authenticated', 'authenticated'
  )
on conflict (id) do nothing;

-- Триггер on_auth_user_created сам создаёт profiles/gardens/plots/inventory/
-- specimens для обоих — дальше можно логиниться в приложении под этими email.
