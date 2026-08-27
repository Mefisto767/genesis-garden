// ============================================================================
// Этап 6 — чтение социального состояния (собственный код профиля, входящие
// подарки, недавние контакты). Только SELECT под RLS + один SECURITY DEFINER
// RPC (resolve_public_code) для отображения отправителя — см.
// supabase/migrations/20260827140000_social_stage6.sql. Мутации (send/claim/
// decline/block/unblock) идут через GameApi (Этап 4 паттерн), не отсюда.
// ============================================================================

import { getSupabaseClient } from '../lib/supabaseClient';

export interface PendingGift {
  id: string;
  senderPublicCode: string | null;
  itemType: 'plant' | 'dust' | 'pollen' | 'cutting';
  itemPayload: Record<string, unknown>;
  createdAt: string;
}

export interface GiftHistoryEntry {
  id: string;
  direction: 'sent' | 'received';
  counterpartyPublicCode: string | null;
  itemType: string;
  status: 'pending' | 'claimed' | 'declined';
  createdAt: string;
}

/** Собственный public_code — показывается игроку как «код друга» для приглашений. */
export async function fetchOwnPublicCode(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('public_code').single();
  if (error || !data) return null;
  return data.public_code;
}

/** Входящие неполученные подарки, с именем отправителя уже разрешённым в public_code. */
export async function fetchPendingGifts(): Promise<PendingGift[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('gift_transactions')
    .select('id, sender_id, item_type, item_payload, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  const gifts = await Promise.all(
    data.map(async (row) => {
      const { data: code } = await supabase.rpc('resolve_public_code', { p_profile_id: row.sender_id as string });
      return {
        id: row.id,
        senderPublicCode: (code as string | null) ?? null,
        itemType: row.item_type as PendingGift['itemType'],
        itemPayload: (row.item_payload as Record<string, unknown>) ?? {},
        createdAt: row.created_at,
      };
    })
  );
  return gifts;
}

export interface BlockedContact {
  publicCode: string;
  profileId: string;
}

/** Кого текущий игрок заблокировал — для экрана управления блокировками. */
export async function fetchBlockedUsers(): Promise<BlockedContact[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data: own } = await supabase.from('profiles').select('id').single();
  if (!own) return [];

  const { data, error } = await supabase
    .from('social_connections')
    .select('friend_id')
    .eq('profile_id', own.id)
    .eq('status', 'blocked');
  if (error || !data) return [];

  const resolved = await Promise.all(
    data.map(async (row) => {
      const { data: code } = await supabase.rpc('resolve_public_code', { p_profile_id: row.friend_id as string });
      return { publicCode: (code as string | null) ?? row.friend_id, profileId: row.friend_id as string };
    })
  );
  return resolved;
}

/**
 * «Недавние контакты» (честная оговорка Этапа 6 — см. IMPLEMENTATION_STATUS.md:
 * полноценных friend-requests нет, это производное от истории обмена).
 * Отдаём последние N уникальных публичных кодов, с кем был обмен в любую сторону.
 */
export async function fetchRecentContacts(limit = 10): Promise<string[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data: own } = await supabase.from('profiles').select('id').single();
  if (!own) return [];

  const { data, error } = await supabase
    .from('gift_transactions')
    .select('sender_id, recipient_id, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];

  const seen = new Set<string>();
  const codes: string[] = [];
  for (const row of data) {
    const otherId = row.sender_id === own.id ? row.recipient_id : row.sender_id;
    if (otherId === own.id || seen.has(otherId as string)) continue;
    seen.add(otherId as string);
    const { data: code } = await supabase.rpc('resolve_public_code', { p_profile_id: otherId as string });
    if (code) codes.push(code as string);
    if (codes.length >= limit) break;
  }
  return codes;
}
