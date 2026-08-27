-- Genesis Garden — контентные данные каталога (не тестовые данные — это
-- часть продакшн-схемы, применяется и на реальном проекте). Числа зеркалят
-- apps/web/src/game/config.ts SEED_BALANCE / QUEST_CATALOG 1:1.

insert into public.seed_catalog (id, name, grow_seconds, buy_cost, sell_value, species_id) values
  ('sprout', 'Росток', 60, 5, 8, 1),
  ('common', 'Обычный цветок', 900, 15, 35, 2),
  ('upgraded', 'Улучшенный цветок', 7200, 60, 170, 5)
on conflict (id) do update set
  name = excluded.name,
  grow_seconds = excluded.grow_seconds,
  buy_cost = excluded.buy_cost,
  sell_value = excluded.sell_value,
  species_id = excluded.species_id;

insert into public.quests (id, title, description, goal_type, target, reward_coins, reward_dust) values
  ('first_plant', 'Первая посадка', 'Посади любое семя в саду', 'plant', 1, 5, 0),
  ('first_harvest', 'Первый урожай', 'Собери выросшее растение', 'harvest', 1, 10, 0),
  ('first_breed', 'Первое скрещивание', 'Скрести две особи в лаборатории', 'breed', 1, 0, 3),
  ('harvest_five', 'Опытный садовник', 'Собери урожай 5 раз', 'harvest', 5, 25, 0)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  goal_type = excluded.goal_type,
  target = excluded.target,
  reward_coins = excluded.reward_coins,
  reward_dust = excluded.reward_dust;
