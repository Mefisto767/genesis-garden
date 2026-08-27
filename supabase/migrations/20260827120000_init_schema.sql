-- Genesis Garden — Этап 3: базовая серверная схема.
-- Соглашение: все id — uuid (gen_random_uuid()), деньги/пыль — bigint (монеты
-- целые, дробей в игре нет), время — timestamptz. auth.users предоставляется
-- самим Supabase — здесь мы на него только ссылаемся внешним ключом.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles — публичный профиль игрока поверх auth.users.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  public_code text not null unique,
  display_name text not null default 'Садовник',
  is_admin boolean not null default false,
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Публичный профиль игрока. public_code — код для поиска друзьями (не email).';

-- ---------------------------------------------------------------------------
-- gardens — один сад на игрока (MVP: 1:1). Здесь живёт вся валюта/пыль/pity.
-- ---------------------------------------------------------------------------
create table if not exists public.gardens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  coins bigint not null default 50 check (coins >= 0),
  genetic_dust bigint not null default 0 check (genetic_dust >= 0),
  pity_counter integer not null default 0 check (pity_counter >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- seed_catalog — серверная копия экономики магазина (см. apps/web
-- src/game/config.ts SEED_BALANCE — числа должны совпадать, это
-- ответственность разработчика при изменении баланса, проверяется тестом).
-- ---------------------------------------------------------------------------
create table if not exists public.seed_catalog (
  id text primary key,
  name text not null,
  grow_seconds integer not null check (grow_seconds > 0),
  buy_cost integer not null check (buy_cost >= 0),
  sell_value integer not null check (sell_value >= 0),
  species_id integer not null check (species_id between 1 and 8)
);

-- ---------------------------------------------------------------------------
-- plots — грядки сада. plot_index 0..23, разблокированные с 0..5 по умолчанию.
-- ---------------------------------------------------------------------------
create table if not exists public.plots (
  id uuid primary key default gen_random_uuid(),
  garden_id uuid not null references public.gardens (id) on delete cascade,
  plot_index integer not null check (plot_index >= 0 and plot_index < 24),
  unlocked boolean not null default false,
  seed_id text references public.seed_catalog (id),
  planted_at timestamptz,
  unique (garden_id, plot_index)
);

-- ---------------------------------------------------------------------------
-- plants — экземпляры с геномом (коллекция/специмены).
-- ---------------------------------------------------------------------------
create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  garden_id uuid not null references public.gardens (id) on delete cascade,
  genome jsonb not null,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  mutation_id text,
  created_at timestamptz not null default now(),
  constraint plants_genome_shape check (
    genome ? 'shape' and genome ? 'primary' and genome ? 'secondary' and
    genome ? 'leaf' and genome ? 'pattern' and genome ? 'size' and
    genome ? 'aura' and genome ? 'mutationId'
  )
);

create index if not exists plants_garden_id_idx on public.plants (garden_id);

-- ---------------------------------------------------------------------------
-- plant_ancestry — родословная: кто от кого получен скрещиванием.
-- Для стартовых растений оба родителя NULL.
-- ---------------------------------------------------------------------------
create table if not exists public.plant_ancestry (
  plant_id uuid primary key references public.plants (id) on delete cascade,
  parent_a_id uuid references public.plants (id) on delete set null,
  parent_b_id uuid references public.plants (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- inventory — семена на руках у игрока.
-- ---------------------------------------------------------------------------
create table if not exists public.inventory (
  garden_id uuid not null references public.gardens (id) on delete cascade,
  seed_id text not null references public.seed_catalog (id),
  qty integer not null default 0 check (qty >= 0),
  primary key (garden_id, seed_id)
);

-- ---------------------------------------------------------------------------
-- breeding_jobs — журнал скрещиваний (в MVP синхронные, но лог + идемпотентность
-- живут здесь; задел на асинхронные "тяжёлые" скрещивания в будущем).
-- ---------------------------------------------------------------------------
create table if not exists public.breeding_jobs (
  id uuid primary key default gen_random_uuid(),
  garden_id uuid not null references public.gardens (id) on delete cascade,
  parent_a_id uuid not null references public.plants (id),
  parent_b_id uuid not null references public.plants (id),
  result_plant_id uuid references public.plants (id),
  mutated boolean not null default false,
  pity_triggered boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- economy_ledger — журнал всех изменений монет/пыли (аудит + история покупок).
-- ---------------------------------------------------------------------------
create table if not exists public.economy_ledger (
  id bigserial primary key,
  garden_id uuid not null references public.gardens (id) on delete cascade,
  delta_coins bigint not null default 0,
  delta_dust bigint not null default 0,
  reason text not null,
  request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists economy_ledger_garden_id_idx on public.economy_ledger (garden_id, created_at desc);

-- ---------------------------------------------------------------------------
-- request_log — идемпотентность всех изменяющих RPC. Один request_id — одно
-- реальное выполнение операции; повтор возвращает сохранённый ответ.
-- ---------------------------------------------------------------------------
create table if not exists public.request_log (
  request_id uuid primary key,
  endpoint text not null,
  garden_id uuid references public.gardens (id) on delete cascade,
  response jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- quests / quest_progress
-- ---------------------------------------------------------------------------
create table if not exists public.quests (
  id text primary key,
  title text not null,
  description text not null,
  goal_type text not null check (goal_type in ('plant', 'harvest', 'breed')),
  target integer not null check (target > 0),
  reward_coins integer not null default 0,
  reward_dust integer not null default 0
);

create table if not exists public.quest_progress (
  garden_id uuid not null references public.gardens (id) on delete cascade,
  quest_id text not null references public.quests (id) on delete cascade,
  progress integer not null default 0,
  claimed boolean not null default false,
  primary key (garden_id, quest_id)
);

-- ---------------------------------------------------------------------------
-- seasons — сезонный пропуск (Этап 7 наполнит покупками).
-- ---------------------------------------------------------------------------
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default false
);

-- ---------------------------------------------------------------------------
-- social_connections — друзья / блокировки.
-- ---------------------------------------------------------------------------
create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  unique (profile_id, friend_id),
  check (profile_id <> friend_id)
);

-- ---------------------------------------------------------------------------
-- gift_transactions — подарки/обмен между игроками (без рынка).
-- ---------------------------------------------------------------------------
create table if not exists public.gift_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  item_type text not null check (item_type in ('pollen', 'cutting', 'plant', 'dust')),
  item_payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'declined')),
  request_id uuid unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists gift_transactions_recipient_idx on public.gift_transactions (recipient_id, status);

-- ---------------------------------------------------------------------------
-- purchases / entitlements — монетизация (Этап 7).
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null,
  provider text not null check (provider in ('mock', 'paddle')),
  provider_transaction_id text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'refunded', 'failed')),
  amount_cents integer not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  raw_payload jsonb,
  unique (provider, provider_transaction_id)
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('growth_boost', 'storage_slot', 'cosmetic', 'season_pass')),
  percent numeric,
  quantity integer,
  expires_at timestamptz,
  source_purchase_id uuid references public.purchases (id),
  created_at timestamptz not null default now()
);

create index if not exists entitlements_profile_idx on public.entitlements (profile_id);

-- ---------------------------------------------------------------------------
-- analytics_events / audit_events
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_events (
  id bigserial primary key,
  profile_id uuid references public.profiles (id) on delete set null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_idx on public.analytics_events (event_name, created_at desc);

create table if not exists public.audit_events (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target_table text,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
