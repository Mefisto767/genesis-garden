// ============================================================================
// Этап 7 — чтение покупок/entitlements (RLS уже разрешает SELECT своих строк,
// см. purchases_select_own/entitlements_select_own в
// supabase/migrations/20260827120100_rls.sql). Мутации — через
// PaymentProvider (checkout) и mock_grant_purchase, не отсюда.
// ============================================================================

import { getSupabaseClient } from '../lib/supabaseClient';

export interface PurchaseHistoryEntry {
  id: string;
  productId: string;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: string;
}

export interface ActiveEntitlement {
  id: string;
  type: string;
  percent: number | null;
  quantity: number | null;
  expiresAt: string | null;
}

export async function fetchPurchaseHistory(): Promise<PurchaseHistoryEntry[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('purchases')
    .select('id, product_id, provider, status, amount_cents, currency, created_at')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    productId: row.product_id,
    provider: row.provider,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    createdAt: row.created_at,
  }));
}

/** Активные (не истёкшие) entitlements — "восстановить покупки" — это просто повторное чтение своих же данных. */
export async function fetchActiveEntitlements(): Promise<ActiveEntitlement[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('entitlements')
    .select('id, type, percent, quantity, expires_at')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  const now = Date.now();
  return data
    .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
    .map((row) => ({
      id: row.id,
      type: row.type,
      percent: row.percent,
      quantity: row.quantity,
      expiresAt: row.expires_at,
    }));
}
