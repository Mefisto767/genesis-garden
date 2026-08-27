-- Genesis Garden — серверные RPC. Каждая изменяющая операция:
--   1) идентифицирует garden_id строго через auth.uid() (никогда через
--      параметр от клиента — иначе можно было бы подменить чужой сад);
--   2) идемпотентна по p_request_id: insert в request_log с уникальным
--      p_request_id — если конфликт, значит запрос уже был выполнен успешно
--      (транзакция закоммитилась), возвращаем сохранённый ответ, ничего не
--      повторяя. Если валидация ниже провалится и функция бросит exception —
--      вся транзакция (включая insert в request_log) откатится, то есть тот
--      же request_id можно будет безопасно повторить позже, когда условие
--      изменится (например, растение дозреет).
--   3) сама проверяет права/баланс/состояние — клиентским данным не верим.

-- ---------------------------------------------------------------------------
-- Хелперы экономики/генетики, общие для нескольких функций.
-- ---------------------------------------------------------------------------

create or replace function public.active_growth_boost_percent(p_profile_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select least(coalesce(sum(percent), 0), 0.25) -- потолок = BOOSTS_CONFIG.maxTotalGrowthBoostPercent на клиенте
  from public.entitlements
  where profile_id = p_profile_id
    and type = 'growth_boost'
    and (expires_at is null or expires_at > now());
$$;

create or replace function public.advance_quest_progress(p_garden_id uuid, p_goal_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id, target from public.quests where goal_type = p_goal_type loop
    insert into public.quest_progress (garden_id, quest_id, progress)
    values (p_garden_id, r.id, 1)
    on conflict (garden_id, quest_id) do update
      set progress = least(public.quest_progress.progress + 1, r.target)
      where public.quest_progress.progress < r.target;
  end loop;
end;
$$;

-- Геном для новой случайной особи (стартовые растения нового игрока).
-- Пулы значений СТРОГО совпадают с GENETICS_CONFIG в apps/web/src/game/config.ts
-- — при изменении баланса нужно поменять оба места (см. docs/ECONOMY.md).
create or replace function public.random_genome()
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_shapes int[] := array[1,2,3,4,5,6,7,8];
  v_primary_pool text[] := array['#FF8C77','#FF6F59','#F5A623','#FFC85C','#B678D9','#CFA1E8','#89D65C','#CBE9F2'];
  v_secondary_pool text[] := array['#F5A623','#FF6F59','#9457BC','#57993A','#E05543','#A9D4E2','#D98C12'];
  v_leaf_pool text[] := array['#6FBE44','#89D65C','#57993A'];
  v_size_tiers text[] := array['small','normal','normal','large','giant'];
  v_aura_tiers text[] := array['none','none','none','faint','faint','glow'];
  v_primary text;
  v_secondary text;
  v_pattern text;
begin
  v_primary := v_primary_pool[1 + floor(random() * array_length(v_primary_pool, 1))::int];
  v_secondary := v_secondary_pool[1 + floor(random() * array_length(v_secondary_pool, 1))::int];
  v_pattern := case when random() < 0.5 then 'solid' else 'duotone' end;
  if v_pattern = 'solid' then
    v_secondary := v_primary;
  end if;
  return jsonb_build_object(
    'shape', v_shapes[1 + floor(random() * array_length(v_shapes, 1))::int],
    'primary', v_primary,
    'secondary', v_secondary,
    'leaf', v_leaf_pool[1 + floor(random() * array_length(v_leaf_pool, 1))::int],
    'pattern', v_pattern,
    'size', v_size_tiers[1 + floor(random() * array_length(v_size_tiers, 1))::int],
    'aura', v_aura_tiers[1 + floor(random() * array_length(v_aura_tiers, 1))::int],
    'mutationId', null
  );
end;
$$;

-- Редкость по геному+мутации — зеркало rarityOf() из genetics.ts (RARITY_SCORING).
create or replace function public.rarity_of(p_genome jsonb, p_mutation_id text)
returns text
language plpgsql
immutable
as $$
declare
  v_score int := 0;
begin
  if p_mutation_id = 'phoenix' then return 'legendary'; end if;
  if p_mutation_id in ('stardust', 'prism') then return 'epic'; end if;
  if p_mutation_id = 'golden_vein' then return 'rare'; end if;

  v_score := v_score + case p_genome->>'size' when 'giant' then 2 when 'large' then 1 else 0 end;
  v_score := v_score + case p_genome->>'aura' when 'radiant' then 3 when 'glow' then 2 when 'faint' then 1 else 0 end;
  v_score := v_score + case when p_genome->>'pattern' = 'duotone' then 1 else 0 end;

  if v_score >= 5 then return 'epic';
  elsif v_score >= 3 then return 'rare';
  elsif v_score >= 1 then return 'uncommon';
  else return 'common';
  end if;
end;
$$;

create or replace function public.generate_public_code()
returns text
language sql
volatile
as $$
  select 'GG-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
$$;

-- ---------------------------------------------------------------------------
-- handle_new_user — триггер на auth.users: создаёт profile+garden+стартовый
-- набор (24 грядки, 6 разблокированы, 3 ростка, 2 стартовых специмена) —
-- ровно как createInitialState() на клиенте (apps/web/src/game/store.ts).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_garden_id uuid;
  v_attempt int := 0;
  v_genome jsonb;
begin
  loop
    v_code := public.generate_public_code();
    begin
      insert into public.profiles (id, public_code) values (new.id, v_code);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'could_not_generate_public_code';
      end if;
    end;
  end loop;

  insert into public.gardens (owner_id) values (new.id) returning id into v_garden_id;

  insert into public.plots (garden_id, plot_index, unlocked)
  select v_garden_id, i, i < 6 from generate_series(0, 23) as i;

  insert into public.inventory (garden_id, seed_id, qty) values (v_garden_id, 'sprout', 3);

  for i in 1..2 loop
    v_genome := public.random_genome();
    insert into public.plants (garden_id, genome, rarity)
    values (v_garden_id, v_genome, public.rarity_of(v_genome, null));
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- plant
-- ---------------------------------------------------------------------------
create or replace function public.plant(p_plot_index integer, p_seed_id text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_owned integer;
  v_available boolean;
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_garden_id from public.gardens where owner_id = auth.uid();
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'plant', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select (unlocked and seed_id is null) into v_available
    from public.plots where garden_id = v_garden_id and plot_index = p_plot_index for update;
  if v_available is null then raise exception 'invalid_plot'; end if;
  if not v_available then raise exception 'plot_not_available'; end if;

  select qty into v_owned from public.inventory where garden_id = v_garden_id and seed_id = p_seed_id;
  if coalesce(v_owned, 0) <= 0 then raise exception 'seed_not_owned'; end if;

  update public.inventory set qty = qty - 1 where garden_id = v_garden_id and seed_id = p_seed_id;
  update public.plots set seed_id = p_seed_id, planted_at = now()
    where garden_id = v_garden_id and plot_index = p_plot_index;
  perform public.advance_quest_progress(v_garden_id, 'plant');

  v_response := jsonb_build_object('ok', true, 'plot_index', p_plot_index, 'seed_id', p_seed_id);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- harvest
-- ---------------------------------------------------------------------------
create or replace function public.harvest(p_plot_index integer, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_seed_id text;
  v_planted_at timestamptz;
  v_grow_seconds integer;
  v_sell_value integer;
  v_boost numeric;
  v_effective_elapsed numeric;
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_garden_id from public.gardens where owner_id = auth.uid();
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'harvest', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select seed_id, planted_at into v_seed_id, v_planted_at
    from public.plots where garden_id = v_garden_id and plot_index = p_plot_index for update;
  if v_seed_id is null or v_planted_at is null then raise exception 'plot_not_growing'; end if;

  select grow_seconds, sell_value into v_grow_seconds, v_sell_value
    from public.seed_catalog where id = v_seed_id;

  v_boost := public.active_growth_boost_percent(auth.uid());
  v_effective_elapsed := extract(epoch from (now() - v_planted_at)) * (1 + v_boost);
  if v_effective_elapsed < v_grow_seconds then
    raise exception 'not_ready_yet';
  end if;

  update public.plots set seed_id = null, planted_at = null
    where garden_id = v_garden_id and plot_index = p_plot_index;
  update public.gardens set coins = coins + v_sell_value, updated_at = now() where id = v_garden_id;
  insert into public.economy_ledger (garden_id, delta_coins, reason, request_id)
    values (v_garden_id, v_sell_value, 'harvest', p_request_id);
  perform public.advance_quest_progress(v_garden_id, 'harvest');

  v_response := jsonb_build_object('ok', true, 'coins_gained', v_sell_value);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- expand_plot (разблокировка грядки)
-- ---------------------------------------------------------------------------
create or replace function public.expand_plot(p_plot_index integer, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_already boolean;
  v_cost integer;
  v_coins bigint;
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_garden_id from public.gardens where owner_id = auth.uid();
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'expand_plot', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select unlocked into v_already
    from public.plots where garden_id = v_garden_id and plot_index = p_plot_index for update;
  if v_already is null then raise exception 'invalid_plot'; end if;
  if v_already then raise exception 'already_unlocked'; end if;

  -- GARDEN_CONFIG на клиенте: unlockCostBase=20, unlockCostStep=12, startUnlockedPlots=6
  v_cost := 20 + greatest(p_plot_index - 6, 0) * 12;

  select coins into v_coins from public.gardens where id = v_garden_id for update;
  if v_coins < v_cost then raise exception 'insufficient_coins'; end if;

  update public.gardens set coins = coins - v_cost, updated_at = now() where id = v_garden_id;
  update public.plots set unlocked = true where garden_id = v_garden_id and plot_index = p_plot_index;
  insert into public.economy_ledger (garden_id, delta_coins, reason, request_id)
    values (v_garden_id, -v_cost, 'expand_plot', p_request_id);

  v_response := jsonb_build_object('ok', true, 'cost', v_cost);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- buy_seed
-- ---------------------------------------------------------------------------
create or replace function public.buy_seed(p_seed_id text, p_qty integer, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_buy_cost integer;
  v_total integer;
  v_coins bigint;
  v_cached jsonb;
  v_response jsonb;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'invalid_qty'; end if;

  select id into v_garden_id from public.gardens where owner_id = auth.uid();
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'buy_seed', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select buy_cost into v_buy_cost from public.seed_catalog where id = p_seed_id;
  if v_buy_cost is null then raise exception 'unknown_seed'; end if;
  v_total := v_buy_cost * p_qty;

  select coins into v_coins from public.gardens where id = v_garden_id for update;
  if v_coins < v_total then raise exception 'insufficient_coins'; end if;

  update public.gardens set coins = coins - v_total, updated_at = now() where id = v_garden_id;
  insert into public.inventory (garden_id, seed_id, qty) values (v_garden_id, p_seed_id, p_qty)
    on conflict (garden_id, seed_id) do update set qty = public.inventory.qty + excluded.qty;
  insert into public.economy_ledger (garden_id, delta_coins, reason, request_id)
    values (v_garden_id, -v_total, 'buy_seed', p_request_id);

  v_response := jsonb_build_object('ok', true, 'spent', v_total);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- breed — прямой порт breed() из apps/web/src/game/genetics.ts на PL/pgSQL,
-- значения GENETICS_CONFIG/MUTATIONS_CONFIG/RARITY_SCORING захардкожены здесь
-- 1:1 (см. docs/ECONOMY.md о необходимости синхронизации при изменении баланса).
-- ---------------------------------------------------------------------------
create or replace function public.breed(p_parent_a uuid, p_parent_b uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_coins bigint;
  v_pity integer;
  v_cached jsonb;
  v_response jsonb;
  v_a jsonb;
  v_b jsonb;

  v_breed_cost integer := 12;       -- BREEDING_CONFIG.breedCost
  v_dust_min integer := 2;          -- BREEDING_CONFIG.dustRewardMin
  v_dust_max integer := 5;          -- BREEDING_CONFIG.dustRewardMax
  v_dust_gained integer;

  v_shapes int[] := array[1,2,3,4,5,6,7,8];
  v_primary_pool text[] := array['#FF8C77','#FF6F59','#F5A623','#FFC85C','#B678D9','#CFA1E8','#89D65C','#CBE9F2'];
  v_secondary_pool text[] := array['#F5A623','#FF6F59','#9457BC','#57993A','#E05543','#A9D4E2','#D98C12'];
  v_leaf_pool text[] := array['#6FBE44','#89D65C','#57993A'];
  v_size_tiers text[] := array['small','normal','normal','large','giant'];
  v_aura_tiers text[] := array['none','none','none','faint','faint','glow'];
  v_mutation_ids text[] := array['golden_vein','stardust','prism','phoenix'];

  v_pity_threshold integer := 10;         -- GENETICS_CONFIG.pityThreshold
  v_gene_mutate_chance numeric := 0.08;   -- GENETICS_CONFIG.geneMutateChance
  v_mutation_chance numeric := 0.06;      -- GENETICS_CONFIG.mutationChance
  v_pity_mutation_chance numeric := 0.7;  -- GENETICS_CONFIG.pityMutationChance
  v_pity_trait_chance numeric := 0.35;    -- GENETICS_CONFIG.pityTraitChance

  v_force_gene_mutation boolean;
  v_forced_once boolean := false;
  v_mutated boolean := false;

  v_shape int;
  v_primary text;
  v_secondary text;
  v_leaf text;
  v_pattern text;
  v_size text;
  v_aura text;
  v_mutation_id text := null;

  v_pity_triggered boolean;
  v_next_pity integer;
  v_new_plant_id uuid;
  v_genome jsonb;
  v_rarity text;
begin
  if p_parent_a = p_parent_b then raise exception 'same_parent'; end if;

  select id, coins, pity_counter into v_garden_id, v_coins, v_pity
    from public.gardens where owner_id = auth.uid() for update;
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'breed', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select genome into v_a from public.plants where id = p_parent_a and garden_id = v_garden_id;
  select genome into v_b from public.plants where id = p_parent_b and garden_id = v_garden_id;
  if v_a is null or v_b is null then raise exception 'parent_not_owned'; end if;
  if v_coins < v_breed_cost then raise exception 'insufficient_coins'; end if;

  v_force_gene_mutation := v_pity >= v_pity_threshold;

  if random() < v_gene_mutate_chance or (v_force_gene_mutation and not v_forced_once and random() < v_pity_mutation_chance) then
    v_mutated := true; v_forced_once := true;
    v_shape := v_shapes[1 + floor(random() * array_length(v_shapes, 1))::int];
  else
    v_shape := case when random() < 0.5 then (v_a->>'shape')::int else (v_b->>'shape')::int end;
  end if;

  if random() < v_gene_mutate_chance or (v_force_gene_mutation and not v_forced_once and random() < v_pity_mutation_chance) then
    v_mutated := true; v_forced_once := true;
    v_primary := v_primary_pool[1 + floor(random() * array_length(v_primary_pool, 1))::int];
  else
    v_primary := case when random() < 0.5 then v_a->>'primary' else v_b->>'primary' end;
  end if;

  if random() < v_gene_mutate_chance or (v_force_gene_mutation and not v_forced_once and random() < v_pity_mutation_chance) then
    v_mutated := true; v_forced_once := true;
    v_secondary := v_secondary_pool[1 + floor(random() * array_length(v_secondary_pool, 1))::int];
  else
    v_secondary := case when random() < 0.5 then v_a->>'secondary' else v_b->>'secondary' end;
  end if;

  if random() < v_gene_mutate_chance or (v_force_gene_mutation and not v_forced_once and random() < v_pity_mutation_chance) then
    v_mutated := true; v_forced_once := true;
    v_leaf := v_leaf_pool[1 + floor(random() * array_length(v_leaf_pool, 1))::int];
  else
    v_leaf := case when random() < 0.5 then v_a->>'leaf' else v_b->>'leaf' end;
  end if;

  if random() < v_gene_mutate_chance or (v_force_gene_mutation and not v_forced_once and random() < v_pity_mutation_chance) then
    v_mutated := true; v_forced_once := true;
    v_pattern := case when random() < 0.5 then 'solid' else 'duotone' end;
  else
    v_pattern := case when random() < 0.5 then v_a->>'pattern' else v_b->>'pattern' end;
  end if;

  if random() < v_gene_mutate_chance or (v_force_gene_mutation and not v_forced_once and random() < v_pity_mutation_chance) then
    v_mutated := true; v_forced_once := true;
    v_size := v_size_tiers[1 + floor(random() * array_length(v_size_tiers, 1))::int];
  else
    v_size := case when random() < 0.5 then v_a->>'size' else v_b->>'size' end;
  end if;

  if random() < v_gene_mutate_chance or (v_force_gene_mutation and not v_forced_once and random() < v_pity_mutation_chance) then
    v_mutated := true; v_forced_once := true;
    v_aura := v_aura_tiers[1 + floor(random() * array_length(v_aura_tiers, 1))::int];
  else
    v_aura := case when random() < 0.5 then v_a->>'aura' else v_b->>'aura' end;
  end if;

  if v_pattern = 'solid' then v_secondary := v_primary; end if;

  v_pity_triggered := v_force_gene_mutation and v_mutated;
  v_next_pity := case when v_mutated then 0 else v_pity + 1 end;

  if v_mutated and random() < v_mutation_chance then
    v_mutation_id := v_mutation_ids[1 + floor(random() * array_length(v_mutation_ids, 1))::int];
  end if;
  if v_pity_triggered and v_mutation_id is null and random() < v_pity_trait_chance then
    v_mutation_id := v_mutation_ids[1 + floor(random() * array_length(v_mutation_ids, 1))::int];
  end if;

  v_genome := jsonb_build_object(
    'shape', v_shape, 'primary', v_primary, 'secondary', v_secondary, 'leaf', v_leaf,
    'pattern', v_pattern, 'size', v_size, 'aura', v_aura, 'mutationId', v_mutation_id
  );
  v_rarity := public.rarity_of(v_genome, v_mutation_id);
  v_dust_gained := v_dust_min + floor(random() * (v_dust_max - v_dust_min + 1))::int;

  insert into public.plants (garden_id, genome, rarity, mutation_id)
    values (v_garden_id, v_genome, v_rarity, v_mutation_id)
    returning id into v_new_plant_id;
  insert into public.plant_ancestry (plant_id, parent_a_id, parent_b_id)
    values (v_new_plant_id, p_parent_a, p_parent_b);
  insert into public.breeding_jobs (garden_id, parent_a_id, parent_b_id, result_plant_id, mutated, pity_triggered)
    values (v_garden_id, p_parent_a, p_parent_b, v_new_plant_id, v_mutated, v_pity_triggered);

  update public.gardens
    set coins = coins - v_breed_cost, genetic_dust = genetic_dust + v_dust_gained,
        pity_counter = v_next_pity, updated_at = now()
    where id = v_garden_id;
  insert into public.economy_ledger (garden_id, delta_coins, delta_dust, reason, request_id)
    values (v_garden_id, -v_breed_cost, v_dust_gained, 'breed', p_request_id);
  perform public.advance_quest_progress(v_garden_id, 'breed');

  v_response := jsonb_build_object(
    'ok', true, 'plant_id', v_new_plant_id, 'genome', v_genome, 'rarity', v_rarity,
    'mutated', v_mutated, 'pity_triggered', v_pity_triggered, 'dust_gained', v_dust_gained,
    'next_pity_counter', v_next_pity
  );
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- recycle_plant — растение -> генетическая пыль (Этап 5). Клиентский
-- GameStore.recycleSpecimen() зеркалирует эту же формулу (см. config.ts
-- BREEDING_CONFIG.recycleDustReward и docs/ECONOMY.md) — расхождение
-- recycle vs sell устранено.
-- ---------------------------------------------------------------------------
create or replace function public.recycle_plant(p_plant_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_exists boolean;
  v_dust_reward integer := 5; -- BREEDING_CONFIG.recycleDustReward
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_garden_id from public.gardens where owner_id = auth.uid();
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'recycle_plant', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select exists(select 1 from public.plants where id = p_plant_id and garden_id = v_garden_id) into v_exists;
  if not v_exists then raise exception 'plant_not_owned'; end if;

  delete from public.plants where id = p_plant_id and garden_id = v_garden_id;
  update public.gardens set genetic_dust = genetic_dust + v_dust_reward, updated_at = now() where id = v_garden_id;
  insert into public.economy_ledger (garden_id, delta_dust, reason, request_id)
    values (v_garden_id, v_dust_reward, 'recycle_plant', p_request_id);

  v_response := jsonb_build_object('ok', true, 'dust_gained', v_dust_reward);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_quest
-- ---------------------------------------------------------------------------
create or replace function public.claim_quest(p_quest_id text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_target integer;
  v_reward_coins integer;
  v_reward_dust integer;
  v_progress integer;
  v_claimed boolean;
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_garden_id from public.gardens where owner_id = auth.uid();
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'claim_quest', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select target, reward_coins, reward_dust into v_target, v_reward_coins, v_reward_dust
    from public.quests where id = p_quest_id;
  if v_target is null then raise exception 'unknown_quest'; end if;

  select progress, claimed into v_progress, v_claimed
    from public.quest_progress where garden_id = v_garden_id and quest_id = p_quest_id for update;
  if coalesce(v_claimed, false) then raise exception 'already_claimed'; end if;
  if coalesce(v_progress, 0) < v_target then raise exception 'quest_not_complete'; end if;

  update public.quest_progress set claimed = true where garden_id = v_garden_id and quest_id = p_quest_id;
  update public.gardens
    set coins = coins + v_reward_coins, genetic_dust = genetic_dust + v_reward_dust, updated_at = now()
    where id = v_garden_id;
  insert into public.economy_ledger (garden_id, delta_coins, delta_dust, reason, request_id)
    values (v_garden_id, v_reward_coins, v_reward_dust, 'claim_quest:' || p_quest_id, p_request_id);

  v_response := jsonb_build_object('ok', true, 'reward_coins', v_reward_coins, 'reward_dust', v_reward_dust);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- send_gift / claim_gift / decline_gift
-- pollen/cutting из мастер-промта пока не имеют отдельного ресурса в игре
-- (только genetic_dust) — поддержаны в схеме (CHECK на gift_transactions),
-- но RPC пока принимает только 'plant' и 'dust'; полноценно — Этап 6.
-- ---------------------------------------------------------------------------
create or replace function public.send_gift(
  p_recipient_public_code text,
  p_item_type text,
  p_item_payload jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_profile uuid := auth.uid();
  v_recipient_profile uuid;
  v_sender_garden uuid;
  v_gift_id uuid;
  v_cached jsonb;
  v_response jsonb;
  v_daily_limit integer := 5; -- лимит подарков/сутки, см. docs/ECONOMY.md
  v_sent_today integer;
  v_plant_id uuid;
  v_plant_genome jsonb;
  v_plant_rarity text;
  v_plant_mutation text;
  v_dust_amount integer;
  v_final_payload jsonb;
begin
  if p_item_type not in ('plant', 'dust') then
    raise exception 'unsupported_item_type';
  end if;

  select id into v_sender_garden from public.gardens where owner_id = v_sender_profile;
  if v_sender_garden is null then raise exception 'garden_not_found'; end if;

  select id into v_recipient_profile from public.profiles where public_code = p_recipient_public_code;
  if v_recipient_profile is null then raise exception 'recipient_not_found'; end if;
  if v_recipient_profile = v_sender_profile then raise exception 'cannot_gift_self'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'send_gift', v_sender_garden);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select count(*) into v_sent_today from public.gift_transactions
    where sender_id = v_sender_profile and created_at > now() - interval '24 hours';
  if v_sent_today >= v_daily_limit then raise exception 'daily_gift_limit_reached'; end if;

  if p_item_type = 'plant' then
    v_plant_id := (p_item_payload->>'plant_id')::uuid;
    select genome, rarity, mutation_id into v_plant_genome, v_plant_rarity, v_plant_mutation
      from public.plants where id = v_plant_id and garden_id = v_sender_garden;
    if v_plant_genome is null then raise exception 'plant_not_owned'; end if;
    delete from public.plants where id = v_plant_id;
    v_final_payload := jsonb_build_object('genome', v_plant_genome, 'rarity', v_plant_rarity, 'mutation_id', v_plant_mutation);
  else
    v_dust_amount := (p_item_payload->>'amount')::int;
    if v_dust_amount is null or v_dust_amount <= 0 then raise exception 'invalid_amount'; end if;
    update public.gardens set genetic_dust = genetic_dust - v_dust_amount
      where id = v_sender_garden and genetic_dust >= v_dust_amount;
    if not found then raise exception 'insufficient_dust'; end if;
    v_final_payload := jsonb_build_object('amount', v_dust_amount);
  end if;

  insert into public.gift_transactions (sender_id, recipient_id, item_type, item_payload, request_id)
    values (v_sender_profile, v_recipient_profile, p_item_type, v_final_payload, p_request_id)
    returning id into v_gift_id;

  v_response := jsonb_build_object('ok', true, 'gift_id', v_gift_id);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

create or replace function public.claim_gift(p_gift_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient_profile uuid := auth.uid();
  v_recipient_garden uuid;
  v_gift record;
  v_cached jsonb;
  v_response jsonb;
  v_new_plant_id uuid;
begin
  select id into v_recipient_garden from public.gardens where owner_id = v_recipient_profile;
  if v_recipient_garden is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'claim_gift', v_recipient_garden);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select * into v_gift from public.gift_transactions where id = p_gift_id for update;
  if v_gift is null then raise exception 'gift_not_found'; end if;
  if v_gift.recipient_id <> v_recipient_profile then raise exception 'not_your_gift'; end if;
  if v_gift.status <> 'pending' then raise exception 'gift_already_resolved'; end if;

  if v_gift.item_type = 'plant' then
    insert into public.plants (garden_id, genome, rarity, mutation_id)
      values (
        v_recipient_garden,
        v_gift.item_payload->'genome',
        v_gift.item_payload->>'rarity',
        nullif(v_gift.item_payload->>'mutation_id', '')
      )
      returning id into v_new_plant_id;
  elsif v_gift.item_type = 'dust' then
    update public.gardens set genetic_dust = genetic_dust + (v_gift.item_payload->>'amount')::int, updated_at = now()
      where id = v_recipient_garden;
  end if;

  update public.gift_transactions set status = 'claimed', claimed_at = now() where id = p_gift_id;

  v_response := jsonb_build_object('ok', true, 'item_type', v_gift.item_type, 'new_plant_id', v_new_plant_id);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

create or replace function public.decline_gift(p_gift_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient_profile uuid := auth.uid();
  v_recipient_garden uuid;
  v_sender_garden uuid;
  v_gift record;
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_recipient_garden from public.gardens where owner_id = v_recipient_profile;
  if v_recipient_garden is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'decline_gift', v_recipient_garden);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select * into v_gift from public.gift_transactions where id = p_gift_id for update;
  if v_gift is null then raise exception 'gift_not_found'; end if;
  if v_gift.recipient_id <> v_recipient_profile then raise exception 'not_your_gift'; end if;
  if v_gift.status <> 'pending' then raise exception 'gift_already_resolved'; end if;

  select id into v_sender_garden from public.gardens where owner_id = v_gift.sender_id;
  if v_sender_garden is not null then
    if v_gift.item_type = 'plant' then
      insert into public.plants (garden_id, genome, rarity, mutation_id)
        values (
          v_sender_garden,
          v_gift.item_payload->'genome',
          v_gift.item_payload->>'rarity',
          nullif(v_gift.item_payload->>'mutation_id', '')
        );
    elsif v_gift.item_type = 'dust' then
      update public.gardens set genetic_dust = genetic_dust + (v_gift.item_payload->>'amount')::int, updated_at = now()
        where id = v_sender_garden;
    end if;
  end if;

  update public.gift_transactions set status = 'declined' where id = p_gift_id;

  v_response := jsonb_build_object('ok', true);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_purchase — вызывается ТОЛЬКО из платёжного webhook (service_role),
-- никогда напрямую клиентом. EXECUTE отозван у authenticated/anon ниже.
-- ---------------------------------------------------------------------------
create or replace function public.grant_purchase(
  p_profile_id uuid,
  p_product_id text,
  p_provider text,
  p_provider_transaction_id text,
  p_amount_cents integer,
  p_currency text,
  p_raw_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_existing uuid;
  v_response jsonb;
begin
  -- Идемпотентность по (provider, provider_transaction_id) — так же
  -- защищена уникальным индексом на purchases; здесь читаем заранее, чтобы
  -- не плодить дублирующиеся entitlements при повторном вызове webhook'а.
  select id into v_existing from public.purchases
    where provider = p_provider and provider_transaction_id = p_provider_transaction_id;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'already_processed', true, 'purchase_id', v_existing);
  end if;

  insert into public.purchases (
    profile_id, product_id, provider, provider_transaction_id, status,
    amount_cents, currency, raw_payload, completed_at
  )
  values (p_profile_id, p_product_id, p_provider, p_provider_transaction_id, 'completed',
          p_amount_cents, p_currency, p_raw_payload, now())
  returning id into v_purchase_id;

  -- Каталог товаров -> entitlements. Полный каталог — Этап 7; здесь минимум
  -- для рабочего пути покупка -> entitlement.
  if p_product_id = 'greenhouse_boost' then
    insert into public.entitlements (profile_id, type, percent, expires_at, source_purchase_id)
      values (p_profile_id, 'growth_boost', 0.10, now() + interval '30 days', v_purchase_id);
  elsif p_product_id = 'season_pass' then
    insert into public.entitlements (profile_id, type, expires_at, source_purchase_id)
      values (p_profile_id, 'season_pass', now() + interval '60 days', v_purchase_id);
  end if;

  v_response := jsonb_build_object('ok', true, 'purchase_id', v_purchase_id);
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- log_analytics_event — единственный способ для клиента писать в analytics_events.
-- ---------------------------------------------------------------------------
create or replace function public.log_analytics_event(p_event_name text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_name is null or length(p_event_name) = 0 or length(p_event_name) > 64 then
    raise exception 'invalid_event_name';
  end if;
  if pg_column_size(p_payload) > 4096 then
    raise exception 'payload_too_large';
  end if;
  insert into public.analytics_events (profile_id, event_name, payload) values (auth.uid(), p_event_name, p_payload);
end;
$$;

-- ---------------------------------------------------------------------------
-- Права выполнения: по умолчанию Postgres даёт EXECUTE всем (PUBLIC) — здесь
-- явно сужаем до того, что реально нужно, чтобы anon не мог даже пытаться
-- дёргать игровые операции.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.plant(integer, text, uuid),
  public.harvest(integer, uuid),
  public.expand_plot(integer, uuid),
  public.buy_seed(text, integer, uuid),
  public.breed(uuid, uuid, uuid),
  public.recycle_plant(uuid, uuid),
  public.claim_quest(text, uuid),
  public.send_gift(text, text, jsonb, uuid),
  public.claim_gift(uuid, uuid),
  public.decline_gift(uuid, uuid),
  public.log_analytics_event(text, jsonb)
from public, anon;

grant execute on function
  public.plant(integer, text, uuid),
  public.harvest(integer, uuid),
  public.expand_plot(integer, uuid),
  public.buy_seed(text, integer, uuid),
  public.breed(uuid, uuid, uuid),
  public.recycle_plant(uuid, uuid),
  public.claim_quest(text, uuid),
  public.send_gift(text, text, jsonb, uuid),
  public.claim_gift(uuid, uuid),
  public.decline_gift(uuid, uuid),
  public.log_analytics_event(text, jsonb)
to authenticated;

revoke execute on function
  public.grant_purchase(uuid, text, text, text, integer, text, jsonb)
from public, authenticated, anon;

-- service_role — единственная роль, которая должна вызывать grant_purchase
-- (платёжный webhook работает с service-role ключом, не с пользовательской сессией).
grant execute on function
  public.grant_purchase(uuid, text, text, text, integer, text, jsonb)
to service_role;
