// ============================================================================
// Этап 8 — типизированный набор аналитических событий из мастер-промта.
// Пишутся через log_analytics_event RPC (готов с Этапа 3) в analytics_events,
// читает их только admin (RLS analytics_events_select_admin — see
// supabase/migrations/20260827120100_rls.sql, готово с Этапа 3).
//
// Честная оговорка (см. docs/IMPLEMENTATION_STATUS.md): tutorial_started/
// tutorial_completed объявлены здесь для полноты каталога, но реально нигде
// не вызываются — в игре пока нет онбординг-тьюториала (это отдельный пункт
// Этапа 9). Когда тьюториал появится, ему останется дёргать track(...) с
// уже готовыми именами событий, ничего в этом файле менять не придётся.
// ============================================================================

export type AnalyticsEventName =
  | 'session_started'
  | 'tutorial_started'
  | 'tutorial_completed'
  | 'seed_bought'
  | 'plant_planted'
  | 'plant_harvested'
  | 'first_breed_started'
  | 'first_breed_completed'
  | 'breed_completed'
  | 'plant_recycled'
  | 'share_clicked'
  | 'gift_sent'
  | 'gift_claimed'
  | 'store_opened'
  | 'product_viewed'
  | 'checkout_started'
  | 'checkout_completed'
  | 'purchase_failed'
  | 'day_1_return'
  | 'day_7_return';

/** Все имена — для админ-дашборда (порядок = порядок воронки в UI). */
export const ANALYTICS_EVENT_NAMES: AnalyticsEventName[] = [
  'session_started',
  'tutorial_started',
  'tutorial_completed',
  'seed_bought',
  'plant_planted',
  'plant_harvested',
  'first_breed_started',
  'first_breed_completed',
  'breed_completed',
  'plant_recycled',
  'share_clicked',
  'gift_sent',
  'gift_claimed',
  'store_opened',
  'product_viewed',
  'checkout_started',
  'checkout_completed',
  'purchase_failed',
  'day_1_return',
  'day_7_return',
];
