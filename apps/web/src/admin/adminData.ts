// ============================================================================
// Этап 8 — данные для admin-дашборда. Никаких новых RPC не нужно: RLS-политики
// в supabase/migrations/20260827120100_rls.sql уже дают is_admin()-профилю
// прямой SELECT по profiles/gardens/purchases/entitlements/analytics_events
// (см. блок в конце файла с перечислением таблиц). Мутировать отсюда ничего
// нельзя — это read-only обзор для беты.
//
// Честная оговорка по масштабу: агрегация происходит на клиенте после SELECT
// (без server-side group by/RPC) — сознательный выбор ради простоты и
// прозрачности на масштабе закрытой беты (50–100 игроков, события — низкие
// тысячи строк). До публичного релиза с большим трафиком это стоит заменить
// на серверные материализованные вьюхи/RPC с агрегацией в БД — см.
// docs/ANALYTICS.md.
// ============================================================================

import { getSupabaseClient } from '../lib/supabaseClient';

/** Верхняя граница на выборку событий за один запрос — защита от случайного
 * вытягивания сотен тысяч строк на клиент, если бета неожиданно вырастет. */
const EVENTS_FETCH_LIMIT = 20000;

/** Является ли текущий вошедший пользователь админом (profiles.is_admin).
 * Фильтруем по auth.uid() явно: без фильтра запрос вернул бы ВСЕ профили
 * (RLS даёт админу видеть все строки), а .single() на нескольких строках
 * упал бы с ошибкой — поэтому здесь всегда id = eq(uid), а не голый select. */
export async function checkIsAdmin(): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (userError || !uid) return false;
  const { data, error } = await supabase.from('profiles').select('is_admin').eq('id', uid).single();
  if (error || !data) return false;
  return !!data.is_admin;
}

export interface AdminOverview {
  totalProfiles: number;
  totalGardens: number;
  eventCounts: Record<string, number>;
  eventsSampleTruncated: boolean;
  day1Returns: number;
  day7Returns: number;
  breedFunnel: {
    firstBreedStarted: number;
    firstBreedCompleted: number;
    breedCompleted: number;
  };
  giftsSent: number;
  giftsClaimed: number;
  purchases: {
    total: number;
    completed: number;
    failed: number;
    revenueCents: number;
    byProduct: Record<string, { count: number; revenueCents: number }>;
  };
}

/** Полный обзор для админ-панели. Возвращает null, если облако не настроено
 * или запрос упал (например, RLS отклонила — вызывающая сторона должна была
 * заранее проверить checkIsAdmin(), но полагаться на это вслепую нельзя). */
export async function fetchAdminOverview(): Promise<AdminOverview | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const [profilesRes, gardensRes, eventsRes, purchasesRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('gardens').select('id', { count: 'exact', head: true }),
    supabase
      .from('analytics_events')
      .select('event_name')
      .order('created_at', { ascending: false })
      .limit(EVENTS_FETCH_LIMIT),
    supabase.from('purchases').select('product_id, status, amount_cents'),
  ]);

  if (eventsRes.error || purchasesRes.error) return null;

  const eventCounts: Record<string, number> = {};
  for (const row of eventsRes.data ?? []) {
    eventCounts[row.event_name] = (eventCounts[row.event_name] ?? 0) + 1;
  }

  const purchasesByProduct: Record<string, { count: number; revenueCents: number }> = {};
  let revenueCents = 0;
  let completed = 0;
  let failed = 0;
  const purchaseRows = purchasesRes.data ?? [];
  for (const row of purchaseRows) {
    const bucket = (purchasesByProduct[row.product_id] ??= { count: 0, revenueCents: 0 });
    bucket.count += 1;
    if (row.status === 'completed') {
      completed += 1;
      revenueCents += row.amount_cents;
      bucket.revenueCents += row.amount_cents;
    } else if (row.status === 'failed') {
      failed += 1;
    }
  }

  return {
    totalProfiles: profilesRes.count ?? 0,
    totalGardens: gardensRes.count ?? 0,
    eventCounts,
    eventsSampleTruncated: (eventsRes.data ?? []).length >= EVENTS_FETCH_LIMIT,
    day1Returns: eventCounts.day_1_return ?? 0,
    day7Returns: eventCounts.day_7_return ?? 0,
    breedFunnel: {
      firstBreedStarted: eventCounts.first_breed_started ?? 0,
      firstBreedCompleted: eventCounts.first_breed_completed ?? 0,
      breedCompleted: eventCounts.breed_completed ?? 0,
    },
    giftsSent: eventCounts.gift_sent ?? 0,
    giftsClaimed: eventCounts.gift_claimed ?? 0,
    purchases: {
      total: purchaseRows.length,
      completed,
      failed,
      revenueCents,
      byProduct: purchasesByProduct,
    },
  };
}
