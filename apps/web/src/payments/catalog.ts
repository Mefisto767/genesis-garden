// ============================================================================
// Этап 7 — каталог покупок. Цены/сроки здесь ДОЛЖНЫ совпадать с
// supabase/migrations/20260827150000_payments_stage7.sql
// (_apply_purchase_entitlement) — как и остальной баланс, зеркалируется
// вручную на клиент/сервер, см. docs/ECONOMY.md.
//
// Честная оговорка по охвату (см. docs/IMPLEMENTATION_STATUS.md): каталог
// из мастер-промта также предполагал "слоты хранилища" и "косметику" — в
// игре сейчас нет ни лимита инвентаря (buySeed ничем не ограничен), ни
// системы косметических предметов, так что продавать их означало бы брать
// деньги за ничего не делающую покупку. COMING_SOON ниже — честно показывает
// эти категории в UI как недоступные для покупки, а не тихо опускает их.
// ============================================================================

export type ProductId = 'season_pass' | 'greenhouse_boost' | 'fertilizer_boost';

export interface Product {
  id: ProductId;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
}

export const PRODUCT_CATALOG: Product[] = [
  {
    id: 'season_pass',
    name: 'Сезонный пропуск',
    description: 'Статус поддержки проекта на 60 дней.',
    priceCents: 799,
    currency: 'USD',
  },
  {
    id: 'greenhouse_boost',
    name: 'Теплица',
    description: '+10% к скорости роста растений на 30 дней (суммарно с другими ускорителями не выше +25%).',
    priceCents: 499,
    currency: 'USD',
  },
  {
    id: 'fertilizer_boost',
    name: 'Удобрение',
    description: '+15% к скорости роста растений на 24 часа (суммарно с другими ускорителями не выше +25%).',
    priceCents: 199,
    currency: 'USD',
  },
];

export interface ComingSoonCategory {
  id: string;
  name: string;
  reason: string;
}

/** Категории из ТЗ, которые честно не продаются, пока для них нет реальной механики в игре. */
export const COMING_SOON_CATEGORIES: ComingSoonCategory[] = [
  { id: 'storage', name: 'Слоты хранилища', reason: 'в игре пока нет лимита инвентаря' },
  { id: 'cosmetics', name: 'Косметика', reason: 'в игре пока нет системы косметических предметов' },
];

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function findProduct(id: string): Product | undefined {
  return PRODUCT_CATALOG.find((p) => p.id === id);
}
