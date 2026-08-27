-- Genesis Garden — Row Level Security.
-- Принцип: клиент ЧИТАЕТ только свои строки. Все ИЗМЕНЕНИЯ игровой
-- экономики идут через SECURITY DEFINER RPC-функции (см. следующую
-- миграцию) — прямых grant'ов на insert/update/delete у роли
-- authenticated на игровые таблицы нет вообще, поэтому обойти RPC,
-- отправив запрос напрямую в PostgREST, невозможно.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());
-- display_name — единственное поле, которое имеет смысл менять руками;
-- is_admin/banned/public_code защищены отдельно триггером ниже.

create or replace function public.profiles_protect_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_admin() then
    new.is_admin := old.is_admin;
    new.banned := old.banned;
    new.public_code := old.public_code;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileged_columns_trg on public.profiles;
create trigger profiles_protect_privileged_columns_trg
  before update on public.profiles
  for each row execute function public.profiles_protect_privileged_columns();

-- insert — только служебный триггер handle_new_user (см. миграцию функций),
-- клиенту insert не нужен и не выдан.

-- ---------------------------------------------------------------------------
-- gardens
-- ---------------------------------------------------------------------------
alter table public.gardens enable row level security;

create policy gardens_select_own on public.gardens
  for select using (owner_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Хелпер: принадлежит ли garden_id текущему пользователю.
-- ---------------------------------------------------------------------------
create or replace function public.owns_garden(p_garden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gardens g where g.id = p_garden_id and g.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- plots / plants / plant_ancestry / inventory / breeding_jobs / economy_ledger
-- / quest_progress — select-only своих строк, никаких прямых записей.
-- ---------------------------------------------------------------------------
alter table public.plots enable row level security;
create policy plots_select_own on public.plots
  for select using (public.owns_garden(garden_id) or public.is_admin());

alter table public.plants enable row level security;
create policy plants_select_own on public.plants
  for select using (public.owns_garden(garden_id) or public.is_admin());

alter table public.plant_ancestry enable row level security;
create policy plant_ancestry_select_own on public.plant_ancestry
  for select using (
    public.is_admin() or exists (
      select 1 from public.plants p
      where p.id = plant_ancestry.plant_id and public.owns_garden(p.garden_id)
    )
  );

alter table public.inventory enable row level security;
create policy inventory_select_own on public.inventory
  for select using (public.owns_garden(garden_id) or public.is_admin());

alter table public.breeding_jobs enable row level security;
create policy breeding_jobs_select_own on public.breeding_jobs
  for select using (public.owns_garden(garden_id) or public.is_admin());

alter table public.economy_ledger enable row level security;
create policy economy_ledger_select_own on public.economy_ledger
  for select using (public.owns_garden(garden_id) or public.is_admin());

alter table public.quest_progress enable row level security;
create policy quest_progress_select_own on public.quest_progress
  for select using (public.owns_garden(garden_id) or public.is_admin());

-- request_log — служебная таблица идемпотентности, клиенту не видна вообще
-- (ни select, ни что-либо ещё); читают/пишут только SECURITY DEFINER функции.
alter table public.request_log enable row level security;
-- Ни одной policy для authenticated/anon — по умолчанию RLS запрещает всё.

-- ---------------------------------------------------------------------------
-- seed_catalog / quests / seasons — публичный каталог, читают все.
-- ---------------------------------------------------------------------------
alter table public.seed_catalog enable row level security;
create policy seed_catalog_select_all on public.seed_catalog for select using (true);

alter table public.quests enable row level security;
create policy quests_select_all on public.quests for select using (true);

alter table public.seasons enable row level security;
create policy seasons_select_all on public.seasons for select using (true);

-- ---------------------------------------------------------------------------
-- social_connections
-- ---------------------------------------------------------------------------
alter table public.social_connections enable row level security;
create policy social_connections_select_own on public.social_connections
  for select using (profile_id = auth.uid() or friend_id = auth.uid() or public.is_admin());
-- Записи только через RPC (send_gift/friend-функции появятся в Этапе 6).

-- ---------------------------------------------------------------------------
-- gift_transactions
-- ---------------------------------------------------------------------------
alter table public.gift_transactions enable row level security;
create policy gift_transactions_select_own on public.gift_transactions
  for select using (sender_id = auth.uid() or recipient_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- purchases / entitlements — читает только владелец; пишет только webhook
-- (service_role, который RLS не касается вовсе).
-- ---------------------------------------------------------------------------
alter table public.purchases enable row level security;
create policy purchases_select_own on public.purchases
  for select using (profile_id = auth.uid() or public.is_admin());

alter table public.entitlements enable row level security;
create policy entitlements_select_own on public.entitlements
  for select using (profile_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- analytics_events — insert разрешён (через RPC-обёртку с валидацией payload),
-- select — только админ.
-- ---------------------------------------------------------------------------
alter table public.analytics_events enable row level security;
create policy analytics_events_select_admin on public.analytics_events
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- audit_events — никакого клиентского доступа вообще, ни select, ни insert.
-- ---------------------------------------------------------------------------
alter table public.audit_events enable row level security;
create policy audit_events_select_admin on public.audit_events
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Права на уровне grant: явно забираем insert/update/delete у authenticated
-- на все игровые таблицы. RLS определяет ЧТО видно, GRANT — что вообще
-- разрешено пытаться сделать; без этого шага authenticated по умолчанию
-- унаследует права от роли, в которой создавались таблицы (postgres),
-- поэтому обнуляем их явно и оставляем только то, что нужно.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on
  public.profiles, public.gardens, public.plots, public.plants, public.plant_ancestry,
  public.inventory, public.breeding_jobs, public.economy_ledger, public.request_log,
  public.quest_progress, public.social_connections, public.gift_transactions,
  public.purchases, public.entitlements, public.analytics_events, public.audit_events
from authenticated;

revoke all on public.request_log, public.audit_events from authenticated, anon;

-- profiles: разрешаем update (ограничено RLS + триггером выше на конкретные колонки).
grant update on public.profiles to authenticated;
